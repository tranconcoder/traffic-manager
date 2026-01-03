from PIL import Image
import cv2
import torch
import math
import numpy as np
import os
import io
import socketio
import time
import threading
import queue
import re

# ---------------------------------------------------------------------------- #
#                               GLOBAL CONSTANTS                               #
# ---------------------------------------------------------------------------- #
# Get the absolute path to the model files
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
DETECTOR_PATH = os.path.join(MODEL_DIR, 'LP_detector_nano_61.pt')
OCR_PATH = os.path.join(MODEL_DIR, 'LP_ocr_nano_62.pt')
CONFIDENCE_THRESHOLD = 0.30  # Model confidence threshold

# Image processing configuration
INPUT_SIZE = 1920
SAVE_CROPS = True
USE_HALF_PRECISION = True 
ENABLE_GPU = True 

# Socket.IO configuration
SOCKETIO_SERVER_URL = 'wss://localhost:3000' 
MAX_FPS = 90
QUEUE_SIZE = 5 

# Initialize Socket.IO client with reconnection settings
sio = socketio.Client(
    reconnection=True,
    reconnection_attempts=0,  # Infinite retries
    reconnection_delay=1,
    reconnection_delay_max=5,
    ssl_verify=False
)

# Global variables
running = True
connected = False
last_processing_time = 0
plate_queue = queue.Queue(maxsize=QUEUE_SIZE)
connection_lock = threading.Lock()

# Cached models (loaded once and reused)
yolo_LP_detect = None
yolo_license_plate = None

model_frame_queue = queue.Queue(maxsize=10)

# --------- UTILITY FUNCTIONS (from utils_rotate.py) ---------

def changeContrast(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    enhanced_l_channel = clahe.apply(l_channel)
    enhanced_lab_img = cv2.merge((enhanced_l_channel, a_channel, b_channel))
    enhanced_img = cv2.cvtColor(enhanced_lab_img, cv2.COLOR_LAB2BGR)
    return enhanced_img

def rotate_image(image, angle):
    image_center = tuple(np.array(image.shape[1::-1]) / 2)
    rotation_matrix = cv2.getRotationMatrix2D(image_center, angle, 1.0)
    rotated_image = cv2.warpAffine(image, rotation_matrix, image.shape[1::-1], flags=cv2.INTER_LINEAR)
    return rotated_image

def compute_skew(src_img, center_threshold):
    if len(src_img.shape) == 3:
        height, width, _ = src_img.shape
    elif len(src_img.shape) == 2:
        height, width = src_img.shape
    else:
        print('Unsupported image type')
    blurred_img = cv2.medianBlur(src_img, 3)
    edges = cv2.Canny(blurred_img, threshold1=30, threshold2=100, apertureSize=3, L2gradient=True)
    lines = cv2.HoughLinesP(edges, 1, math.pi/180, 30, minLineLength=width/1.5, maxLineGap=height/3.0)
    if lines is None:
        return 1

    min_line_y = 100
    min_line_position = 0
    for i in range(len(lines)):
        for x1, y1, x2, y2 in lines[i]:
            center_point = [((x1+x2)/2), ((y1+y2)/2)]
            if center_threshold == 1:
                if center_point[1] < 7:
                    continue
            if center_point[1] < min_line_y:
                min_line_y = center_point[1]
                min_line_position = i

    angle = 0.0
    nlines = lines.size
    cnt = 0
    for x1, y1, x2, y2 in lines[min_line_position]:
        ang = np.arctan2(y2 - y1, x2 - x1)
        if math.fabs(ang) <= 30: # excluding extreme rotations
            angle += ang
            cnt += 1
    if cnt == 0:
        return 0.0
    return (angle / cnt)*180/math.pi

def deskew(src_img, change_cons, center_thres):
    if change_cons == 1:
        return rotate_image(src_img, compute_skew(changeContrast(src_img), center_thres))
    else:
        return rotate_image(src_img, compute_skew(src_img, center_thres))

# --------- HELPER FUNCTIONS (from helper.py) ---------

def linear_equation(x1, y1, x2, y2):
    b = y1 - (y2 - y1) * x1 / (x2 - x1)
    a = (y1 - b) / x1
    return a, b

def check_point_linear(x, y, x1, y1, x2, y2):
    a, b = linear_equation(x1, y1, x2, y2)
    y_pred = a*x+b
    return(math.isclose(y_pred, y, abs_tol = 3))

# detect character and number in license plate
def read_plate(yolo_license_plate, im):
    LP_type = "1"
    results = yolo_license_plate(im)
    bb_list = results.pandas().xyxy[0].values.tolist()
    if len(bb_list) == 0 or len(bb_list) < 7 or len(bb_list) > 10:
        return "unknown"
    center_list = []
    y_mean = 0
    y_sum = 0
    for bb in bb_list:
        x_c = (bb[0]+bb[2])/2
        y_c = (bb[1]+bb[3])/2
        y_sum += y_c
        center_list.append([x_c,y_c,bb[-1]])

    # find 2 point to draw line
    l_point = center_list[0]
    r_point = center_list[0]
    for cp in center_list:
        if cp[0] < l_point[0]:
            l_point = cp
        if cp[0] > r_point[0]:
            r_point = cp
    for ct in center_list:
        if l_point[0] != r_point[0]:
            if (check_point_linear(ct[0], ct[1], l_point[0], l_point[1], r_point[0], r_point[1]) == False):
                LP_type = "2"

    y_mean = int(int(y_sum) / len(bb_list))
    size = results.pandas().s

    # 1 line plates and 2 line plates
    line_1 = []
    line_2 = []
    license_plate = ""
    if LP_type == "2":
        for c in center_list:
            if int(c[1]) > y_mean:
                line_2.append(c)
            else:
                line_1.append(c)
        for l1 in sorted(line_1, key = lambda x: x[0]):
            license_plate += str(l1[2])
        license_plate += "-"
        for l2 in sorted(line_2, key = lambda x: x[0]):
            license_plate += str(l2[2])
    else:
        for l in sorted(center_list, key = lambda x: x[0]):
            license_plate += str(l[2])
    return license_plate

# --------- MAIN LICENSE PLATE RECOGNITION CODE (from ocr.py) ---------

def load_models():
    """
    Load YOLO models once and cache them for future use
    Returns:
        Detector model and OCR model
    """
    global yolo_LP_detect, yolo_license_plate
    
    # Check if models are already loaded
    if yolo_LP_detect is not None and yolo_license_plate is not None:
        return yolo_LP_detect, yolo_license_plate
    
    # Temporarily redirect stdout to suppress YOLOv5 loading messages
    import sys
    import os
    original_stdout = sys.stdout
    sys.stdout = open(os.devnull, 'w')
    
    try:
        print("Loading license plate detection models (first time)...")
        # Configure device
        device = 'cpu'
        if ENABLE_GPU:
            try:
                if torch.cuda.is_available():
                    device = 'cuda'
                    gpu_name = torch.cuda.get_device_name(0)
                    print(f"CUDA is available. Using GPU: {gpu_name}")
                else:
                    print("CUDA is not available. Using CPU.")
            except Exception as e:
                print(f"Error checking GPU: {e}. Using CPU.")
        
        # Load YOLO models using the global constants with verbose=False
        yolo_LP_detect = torch.hub.load('yolov5', 'custom', path=DETECTOR_PATH, force_reload=False, source='local', verbose=False)
        yolo_license_plate = torch.hub.load('yolov5', 'custom', path=OCR_PATH, force_reload=False, source='local', verbose=False)
        
        # Move models to appropriate device
        yolo_LP_detect.to(device)
        yolo_license_plate.to(device)
        
        # Use half precision for faster inference if using GPU and enabled
        if device == 'cuda' and USE_HALF_PRECISION:
            yolo_LP_detect = yolo_LP_detect.half()
            yolo_license_plate = yolo_license_plate.half()
        
        # Set model confidence threshold
        yolo_license_plate.conf = CONFIDENCE_THRESHOLD

        # Start model threads
        model_thread = threading.Thread(target=process_license_plates_thread, daemon=True)
        model_thread.start()
    finally:
        # Restore stdout
        sys.stdout.close()
        sys.stdout = original_stdout
    
    return yolo_LP_detect, yolo_license_plate

def recognize_license_plate(image_path=None, image_array=None, detections=None):
    """
    Recognize license plates from either an image path or image array
    Args:
        image_path: Path to the image file
        image_array: OpenCV image array (if image_path is None)
    
    Returns:
        A set of detected license plate numbers
    """
    global yolo_LP_detect, yolo_license_plate
    
    # Read the image
    if image_path is not None:
        print(f"Reading image from: {image_path}")
        img = cv2.imread(image_path)
        if img is None:
            print(f"Error: Could not read image from {image_path}. Check if file exists and is not corrupted.")
            return set(), None
    elif image_array is not None:
        img = image_array
    else:
        print("Error: Either image_path or image_array must be provided.")
        return set(), None
    
    # Resize image if it's too large (for faster processing)
    frame_height, frame_width = img.shape[:2]
    if max(frame_height, frame_width) > 1920:  # If the image is larger than Full HD
        scale = 1920 / max(frame_height, frame_width)
        new_frame_width = int(frame_width * scale)
        new_frame_height = int(frame_height * scale)
        img = cv2.resize(img, (new_frame_width, new_frame_height))
    
    # Create a copy for visualization
    vis_img = img.copy()
    
    # Detect license plates with optimized size
    plates = yolo_LP_detect(img, size=INPUT_SIZE)
    
    # Process detection results
    list_plates = plates.pandas().xyxy[0].values.tolist()
    list_read_plates = dict()
    
    # Process each detected license plate
    detection_ids = [detection.get("id") for detection in detections]
    valid_areas = [detection for detection in detections if detection.get("id") in detection_ids]

    crop_images = dict()


    for plate in list_plates:
        # Only process if confidence is above threshold
        confidence = float(plate[4])
        if confidence < CONFIDENCE_THRESHOLD:
            continue
            
        flag = 0
        x = int(plate[0])  # xmin
        y = int(plate[1])  # ymin
        w = int(plate[2] - plate[0])  # xmax - xmin
        h = int(plate[3] - plate[1])  # ymax - ymin  
        
        # Ensure crop coordinates are within image boundaries
        x = max(0, x)
        y = max(0, y)
        w = min(w, img.shape[1] - x)
        h = min(h, img.shape[0] - y)
        
        # Skip if crop dimensions are too small
        if w < 20 or h < 10:
            continue

        # Skip if license plate is outside valid area
        vehicle_id = None
        if valid_areas is not None:
            is_inside_valid_area = False

            for valid_area in valid_areas:
                x1 = valid_area.get("bbox").get("x1") * frame_width
                x2 = valid_area.get("bbox").get("x2") * frame_width
                y1 = valid_area.get("bbox").get("y1") * frame_height
                y2 = valid_area.get("bbox").get("y2") * frame_height

                if x >= x1 and x + w <= x2 and y >= y1 and y + h <= y2:
                    is_inside_valid_area = True
                    vehicle_id = valid_area.get("id")
                    break

            if not is_inside_valid_area:
                continue
        
        # Crop the license plate
        crop_img = img[y:y+h, x:x+w]
        
        # Save the cropped image (for debugging) - only if enabled
        if SAVE_CROPS:
            crop_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crop.jpg")
            cv2.imwrite(crop_file, crop_img)
        
        # Optimize the deskew process - try fewer orientations for speed
        # First try without deskew, which is fastest
        lp = read_plate(yolo_license_plate, crop_img)
        if lp != "unknown":
            list_read_plates[vehicle_id] = lp
            continue
        
        # If not successful, try deskew with fewer combinations for better speed
        for cc in range(0, 2):
            lp = read_plate(yolo_license_plate, deskew(crop_img, cc, 0))
            if lp != "unknown":
                list_read_plates[vehicle_id] = lp
                flag = 1
                break
            if flag == 1:
                break
    
    return list_read_plates


def detect_license_plate_from_car_event(vehicle_data):
    """
    Detect license plate from a vehicle image in a car event
    Args:
        vehicle_data: Dictionary containing vehicle information
    
    Returns:
        Updated vehicle_data with license plate information
    """
    try:
        # Convert image data to numpy array
        if 'image_data' in vehicle_data:
            image_bytes = vehicle_data['image_data']
            
            # Convert bytes to image
            try:
                # Open as PIL image first
                image = Image.open(io.BytesIO(image_bytes))
                # Convert PIL image to OpenCV format (RGB to BGR)
                frame = np.array(image)
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            except Exception as e:
                print(f"Error decoding image: {e}")
                return vehicle_data
            
            # Detect license plates
            license_plates = recognize_license_plate(image_array=frame)
            
            # Add license plate information to vehicle data
            if license_plates:
                vehicle_data['license_plate'] = list(license_plates)
                print(f"Detected license plate: {list(license_plates)}")
            else:
                vehicle_data['license_plate'] = ["UNKNOWN"]
                
    except Exception as e:
        print(f"Error detecting license plate: {e}")
        vehicle_data['license_plate'] = ["ERROR"]
        
    return vehicle_data

# --------- SOCKETIO EVENT HANDLERS AND PROCESSING ---------

@sio.event
def connect():
    """Handler for connection event"""
    global connected
    connected = True
    print(f"Successfully connected to Socket.IO server: {SOCKETIO_SERVER_URL}")
    print("Waiting for 'violation_detect' events with vehicle images...")

@sio.event
def disconnect():
    """Handler for disconnection event"""
    global connected
    connected = False
    print("Disconnected from Socket.IO server")
    print("Connection manager will attempt to reconnect...")

@sio.on('violation_detect')
def on_license_plate(data):
    """
    Handler for receiving license plate detection events
    Args:
        data: Dictionary containing license plate data with image
    """
    global last_processing_time

    print("Received license plate event")

    camera_id = data.get('camera_id')
    image_id = data.get('image_id')
    violations = data.get('violations')
    buffer = data.get('buffer')
    detections = data.get('detections')

    # Limit processing rate to avoid overload
    current_time = time.time()
    if current_time - last_processing_time < 1.0/MAX_FPS:
        return  # Skip this frame to maintain reasonable frame rate
    
    last_processing_time = current_time
    
    try:
        # Check if we have a valid license plate event with image data
        if not isinstance(data, dict):
            print("Warning: Received license_plate event with invalid data format")
            return
        
        # Add to processing queue
        try:
            plate_queue.put((camera_id, image_id, violations, buffer, detections), block=False)
            print(f"Added license plate image to processing queue")
        except queue.Full:
            # If queue is full, just discard this data
            pass
    
    except Exception as e:
        print(f"Error handling license_plate event: {e}")

def process_license_plates_thread():
    """Background thread to process license plate images"""
    global running, yolo_LP_detect, yolo_license_plate
    
    print("Starting license plate OCR thread")
    
    # Pre-load models for faster inference later
    yolo_LP_detect, yolo_license_plate = load_models()
    print("Models loaded successfully and cached for reuse")
    
    # Set up batch processing variables
    batch_size = 1  # Start with single image processing
    
    while running:
        try:
            # Try to get a plate event from the queue, non-blocking
            try:
                camera_id, image_id, violations, buffer, detections = plate_queue.get(block=False)
                if camera_id is None:
                    print(camera_id)
                    time.sleep(0.01)
                    continue
            except queue.Empty:
                time.sleep(0.01)
                continue
            
            # Convert buffer to image with optimized error handling
            try:
                # Convert bytes to numpy array
                nparr = np.frombuffer(buffer, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                
                if img is None:
                    print(f"Error: Could not decode image for plate")
                    continue
                    
                # Check if image is too small for useful processing
                if img.shape[0] < 20 or img.shape[1] < 20:
                    print(f"Image too small for reliable processing: {img.shape}")
                    continue
            except Exception as e:
                print(f"Error decoding image: {e}")
                continue
            
            # Start timing for inference
            start_time = time.time()
            
            # Use our optimized recognition with cached models
            license_plates = recognize_license_plate(image_array=img, detections=detections)

            print(license_plates)
            
            # Calculate inference time
            inference_time = (time.time() - start_time) * 1000  # ms
            
            # Prepare response with recognition results and include the original data
            plates = dict()
            for key, value in license_plates.items():
                # Kiểm tra định dạng biển số việt nam
                vietnam_plate_regex = r'^[0-9]{2}[A-Z]{1,2}[0-9]{1,5}$'
                if re.match(vietnam_plate_regex, value):
                    plates[key] = value

            response = {
                'camera_id': camera_id,
                'image_id': image_id,
                'inference_time': inference_time,
                'license_plates': plates,
                'violations': violations,
            }

            # Show detected license plates in the command line
            print(f"[LicensePlateOCR] Camera: {camera_id}, Image: {image_id}, "
                  f"Plates: {response['license_plates']}, "
                  f"Inference Time: {inference_time:.2f}ms")

            # Emit license plate OCR results using 'license_plate_ocr' event
            sio.emit('violation_license_plate', response)
            
        except Exception as e:
            print(f"Error in license plate OCR thread: {e}")
            time.sleep(0.1)  # Prevent tight loop if there's an error
    
    print("License plate OCR thread stopped")

def maintain_connection():
    """Thread to manage Socket.IO connection and auto-reconnect"""
    global connected, running
    
    while running:
        try:
            if not connected:
                try:
                    print(f"Attempting to connect to Socket.IO server at {SOCKETIO_SERVER_URL}...")
                    sio.connect(
                        SOCKETIO_SERVER_URL,
                        transports=['websocket'],
                        wait=False
                    )
                except Exception as e:
                    print(f"Failed to connect: {e}")
                    time.sleep(5)  # Wait before retry
            time.sleep(1)  # Check connection status periodically
        except Exception as e:
            print(f"Connection manager error: {e}")
            time.sleep(1)

def main():
    """Main function to run the license plate OCR service"""
    global running
    
    try:
        # Start connection management thread
        connection_thread = threading.Thread(target=maintain_connection, daemon=True)
        connection_thread.start()
        print("Connection management thread started")
        
        # Start processing thread
        processing_thread = threading.Thread(target=process_license_plates_thread, daemon=True)
        processing_thread.start()
        print("License plate processing thread started")
        
        # Keep the main thread running
        while running:
            try:
                time.sleep(1)
            except KeyboardInterrupt:
                break
                
    except Exception as e:
        print(f"Error in main thread: {str(e)}")
        
    finally:
        running = False
        if sio.connected:
            sio.disconnect()
        print("License plate OCR service stopped")

if __name__ == "__main__":
    main()
