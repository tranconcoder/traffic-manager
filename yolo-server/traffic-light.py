import cv2
import numpy as np
import socketio
import base64
import time
import threading
from ultralytics import YOLO
import queue
import io
from PIL import Image

# ---------------------------------------------------------------------------- #
#                              Model configuration                             #
# ---------------------------------------------------------------------------- #
MODEL_PATH = "./models/mhiot-dentinhieu-best-new-nano.pt"
# MODEL_PATH = "./models/mhiot-dentinhieu-best-new.pt"
CONFIDENCE_THRESHOLD = 0.4 
SOCKETIO_SERVER_URL = 'wss://localhost:3000'
ENABLE_GPU = True

# ---------------------------------------------------------------------------- #
#                         Socketio client configuration                        #
# ---------------------------------------------------------------------------- #
sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=1, reconnection_delay_max=3000, ssl_verify=False)
print(f"Initializing Socket.IO client to connect to {SOCKETIO_SERVER_URL}")

# ---------------------------------------------------------------------------- #
#                              Global variables                                #
# ---------------------------------------------------------------------------- #
running = True
connected = False
model = None
last_frame_time = 0
MAX_FPS = 30

# Queue for model processing
model_frame_queue = queue.Queue(maxsize=10)

def get_model_path():
    return MODEL_PATH

def process_frames_thread():
    """Thread function to process frames with the model in the background"""
    global running, model
    
    print("Starting frame processing thread")
    
    while running:
        try:
            # Try to get a frame from the model queue, non-blocking
            try:
                frame_data = model_frame_queue.get(block=False)
                if frame_data is None:
                    time.sleep(0.01)
                    continue
            except queue.Empty:
                time.sleep(0.01)
                continue
            
            frame, cameraId, imageId, created_at = frame_data
            
            # Skip processing if model isn't loaded
            if model is None:
                time.sleep(0.01)
                continue
                
            # Process the frame with YOLO
            start_time = time.time()
            results = model(frame, verbose=False)
            inference_time = (time.time() - start_time) * 1000  # Convert to milliseconds
            
            height, width = frame.shape[:2]
            
            # Process detection results
            detected_signs = []
            
            has_detections = False  # Flag to track if any objects were detected
            
            for result in results:
                boxes = result.boxes
                for box in boxes:
                    confidence = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    
                    # Check if the detected object meets confidence threshold
                    if confidence >= CONFIDENCE_THRESHOLD:
                        has_detections = True
                        # Get bounding box coordinates
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        
                        class_name = model.names[cls_id]
                        
                        # Calculate relative coordinates (0-1 range)
                        rel_x1 = x1 / width
                        rel_y1 = y1 / height
                        rel_x2 = x2 / width
                        rel_y2 = y2 / height
                        
                        # Add detection to results
                        detection_info = {
                            'class': class_name,
                            'confidence': float(confidence),
                            'bbox': {
                                'x1': float(rel_x1),  # Normalized coordinates (0-1)
                                'y1': float(rel_y1),
                                'x2': float(rel_x2),
                                'y2': float(rel_y2),
                                'width': float(rel_x2 - rel_x1),
                                'height': float(rel_y2 - rel_y1)
                            }
                        }
                        
                        detected_signs.append(detection_info)
            
            # Print message whether objects were detected or not
            if has_detections:
                print(f"Traffic Sign Detection: {len(detected_signs)} signs detected")
            else:
                print("Traffic Sign Detection: No traffic signs detected in this frame")
            
            # Prepare response with detection results
            if len(detected_signs) > 0:
                max_confidence = max(detected_signs, key=lambda x: x['confidence'])
                traffic_status = max_confidence['class']

                response = {
                    'cameraId': cameraId,
                    'imageId': imageId,
                    'traffic_status': traffic_status,
                    'detections': detected_signs,
                    'inference_time': inference_time,
                    'image_dimensions': {
                        'width': width,
                        'height': height
                    },
                    'created_at': created_at,
                }

                # Emit detection results back to the server
                sio.emit('traffic_light', response)
                print(f"Detected {len(detected_signs)} traffic signs, inference time: {inference_time:.2f}ms")
            else:
                continue

                    
        except Exception as e:
            print(f"Error in processing thread: {e}")
            time.sleep(0.1)  # Prevent tight loop if there's an error
    
    print("Frame processing thread stopped")

def load_model():
    global model
    model_path = get_model_path()
    print(f"Loading YOLO model: {model_path}")
    
    try:
        # Check GPU availability
        device = 'cpu'  # Default to CPU
        if ENABLE_GPU:
            try:
                import torch
                if torch.cuda.is_available():
                    device = 'cuda'
                    gpu_name = torch.cuda.get_device_name(0)
                    print(f"CUDA is available. Using GPU: {gpu_name}")
                else:
                    print("CUDA is not available. Falling back to CPU.")
            except ImportError:
                print("PyTorch not properly installed. Falling back to CPU.")
            except Exception as e:
                print(f"Error checking GPU: {e}. Falling back to CPU.")

        # Load the model with the selected device
        print(f"Loading model on device: {device}")
        model = YOLO(model_path)
        model.to(device)
        print(f"Model loaded successfully! Running on: {device}")
        print(f"Available classes: {model.names}")
        
        return True
    except Exception as e:
        print(f"Failed to load model: {e}")
        return False

# Socket.IO event handlers
@sio.event
def connect():
    global connected
    connected = True
    print(f"Successfully connected to Socket.IO server: {SOCKETIO_SERVER_URL}")
    print("Waiting for 'image' events...")

    sio.emit("join_all_camera")

@sio.event
def connect_error(error):
    print(f"Connection error: {error}")

@sio.event
def disconnect():
    global connected
    connected = False
    print("Disconnected from Socket.IO server")
    print("Will attempt to reconnect automatically...")

# Function to handle connection management
def maintain_connection():
    global connected, running
    
    while running:
        try:
            if not connected:
                try:
                    print(f"Attempting to connect to Socket.IO server at {SOCKETIO_SERVER_URL}...")
                    sio.connect(SOCKETIO_SERVER_URL, transports=['websocket'])
                except Exception as e:
                    print(f"Failed to connect: {e}")
                    time.sleep(5)  # Wait before retry
            time.sleep(1)  # Check connection status periodically
        except Exception as e:
            print(f"Connection manager error: {e}")
            time.sleep(1)

# Image processing function
@sio.on('image')
def on_image(data):
    global last_frame_time
    
    # Limit frame processing rate to avoid overload
    current_time = time.time()
    if current_time - last_frame_time < 1.0/MAX_FPS:
        return  # Skip this frame to maintain reasonable frame rate
    
    last_frame_time = current_time

    image = data['buffer']
    cameraId = data['cameraId']
    imageId = data['imageId']
    created_at = data['created_at']
    
    try:
        # Convert image data from buffer to numpy array
        if isinstance(image, dict) and 'image' in image:
            # If data is a dictionary with 'image' key
            image_data = image['image']
        else:
            # If data is directly the image buffer
            image_data = image
        
        # Convert the received image data to numpy array
        if isinstance(image_data, str):
            # If it's a base64 encoded string
            image_bytes = base64.b64decode(image_data)
        else:
            # If it's already a binary
            image_bytes = image_data
        
        # Convert bytes to image
        try:
            image = Image.open(io.BytesIO(image_bytes))
            # Convert PIL image to OpenCV format (RGB to BGR)
            frame = np.array(image)
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        except Exception as e:
            print(f"Error decoding image: {e}")
            return
        
        # Get frame dimensions
        height, width = frame.shape[:2]
        
        # Resize the frame if it's too large to save memory
        max_dimension = 1280  # Maximum dimension to process
        if width > max_dimension or height > max_dimension:
            scale = max_dimension / max(width, height)
            frame = cv2.resize(frame, (int(width * scale), int(height * scale)))
        
        # Add the frame to the model processing queue
        try:
            model_frame_queue.put((frame.copy(), cameraId, imageId, created_at), block=False)
        except queue.Full:
            # If model queue is full, just discard this frame for processing
            pass
    
    except Exception as e:
        print(f"Error processing image: {e}")

def main():
    global running
    
    # Load YOLO model
    if not load_model():
        print("Failed to load model. Exiting...")
        return
    
    # Start connection manager thread
    connection_thread = threading.Thread(target=maintain_connection, daemon=True)
    connection_thread.start()
    print("Connection manager started")
    
    # Start processing thread
    processing_thread = threading.Thread(target=process_frames_thread, daemon=True)
    processing_thread.start()
    print("Processing thread started")
    
    # Keep the main thread running
    try:
        while running:
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("Interrupted by user. Shutting down...")
    finally:
        running = False
        if sio.connected:
            sio.disconnect()
        
        # Wait for thread to finish
        processing_thread.join(timeout=2)
        
        print("Application stopped.")

if __name__ == "__main__":
    main()
