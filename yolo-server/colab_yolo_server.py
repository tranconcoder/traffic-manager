# =============================================================================
# YOLO Detection Server for Google Colab
# 
# This script runs 3 YOLO models on Colab with GPU support:
# 1. Vehicle Detection (mhiot-vehicle-best-new.pt)
# 2. Traffic Light Detection (mhiot-dentinhieu-best-new.pt)  
# 3. License Plate Detection + OCR (LP_detector.pt, LP_ocr.pt)
#
# Features:
# - Socket.IO connection with auto-reconnect
# - Ngrok tunnel for public URL
# - Multi-model inference
# =============================================================================

# ============== STEP 1: Installation (Run this cell first) ==============
"""
!pip install ultralytics python-socketio pyngrok opencv-python-headless pillow flask flask-cors -q
!pip install python-engineio -q

# Upload your model files or download from Google Drive
# from google.colab import files
# uploaded = files.upload()  # Upload: mhiot-vehicle-best-new.pt, mhiot-dentinhieu-best-new.pt, LP_detector.pt, LP_ocr.pt
"""

# ============== STEP 2: Main Server Code ==============
import cv2
import numpy as np
import time
import threading
import socketio
import base64
from ultralytics import YOLO
import io
from PIL import Image
import queue
import os
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- Configuration ---
VEHICLE_MODEL_PATH = 'mhiot-vehicle-best-new.pt'
TRAFFIC_LIGHT_MODEL_PATH = 'mhiot-dentinhieu-best-new.pt'
LP_DETECTOR_MODEL_PATH = 'LP_detector.pt'
LP_OCR_MODEL_PATH = 'LP_ocr.pt'

CONFIDENCE_THRESHOLD = 0.5
VEHICLE_CLASSES = ['car', 'truck', 'bus', 'motorcycle', 'bicycle']
ENABLE_TRACKING = True
ENABLE_GPU = True

# Tracking configuration
TRAIL_DURATION = 5.0
MAX_TRAIL_POINTS = 30

# Counting line configuration
ENABLE_COUNTING_LINE = True
COUNTING_LINE_POSITION = 0.5
BIDIRECTIONAL_COUNTING = True

# Global variables
running = True
connected = False
vehicle_model = None
traffic_light_model = None
lp_detector_model = None
lp_ocr_model = None
sio = None
ngrok_url = None

# Dictionary to manage queues and threads for each camera
camera_queues = {}
camera_threads = {}

# Flask App for API endpoints
flask_app = Flask(__name__)
CORS(flask_app)


# ============== API ENDPOINTS ==============
@flask_app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'message': 'YOLO Detection Server is running',
        'models_loaded': {
            'vehicle': vehicle_model is not None,
            'traffic_light': traffic_light_model is not None,
            'lp_detector': lp_detector_model is not None,
            'lp_ocr': lp_ocr_model is not None
        },
        'ngrok_url': ngrok_url,
        'socket_connected': connected
    })


@flask_app.route('/api/test', methods=['GET'])
def api_test():
    """Simple test endpoint"""
    return jsonify({
        'status': 'ok',
        'message': 'API is working!',
        'timestamp': time.time()
    })


@flask_app.route('/api/detect', methods=['POST'])
def api_detect():
    """
    Detect objects in uploaded image
    
    POST /api/detect
    Content-Type: multipart/form-data
    Body: image file
    
    OR
    
    POST /api/detect
    Content-Type: application/json
    Body: {"image": "base64_encoded_image"}
    """
    global vehicle_model, traffic_light_model, lp_detector_model, lp_ocr_model
    
    try:
        # Get image from request
        if 'image' in request.files:
            # Multipart form data
            file = request.files['image']
            image_bytes = file.read()
        elif request.is_json:
            # JSON with base64 image
            data = request.get_json()
            if 'image' not in data:
                return jsonify({'error': 'No image provided'}), 400
            image_bytes = base64.b64decode(data['image'])
        else:
            return jsonify({'error': 'No image provided'}), 400
        
        # Convert to PIL Image then to OpenCV format
        img = Image.open(io.BytesIO(image_bytes))
        frame = np.array(img)
        if len(frame.shape) == 2:  # Grayscale
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        elif frame.shape[2] == 4:  # RGBA
            frame = cv2.cvtColor(frame, cv2.COLOR_RGBA2BGR)
        else:
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        
        height, width = frame.shape[:2]
        start_time = time.time()
        
        all_detections = []
        
        # Vehicle Detection
        if vehicle_model is not None:
            results = vehicle_model(frame, verbose=False)
            for result in results:
                for box in result.boxes:
                    confidence = float(box.conf[0])
                    if confidence >= CONFIDENCE_THRESHOLD:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        cls_id = int(box.cls[0])
                        all_detections.append({
                            'type': 'vehicle',
                            'class': vehicle_model.names[cls_id],
                            'confidence': confidence,
                            'bbox': {
                                'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                                'x1_rel': x1/width, 'y1_rel': y1/height,
                                'x2_rel': x2/width, 'y2_rel': y2/height
                            }
                        })
        
        # Traffic Light Detection
        if traffic_light_model is not None:
            results = traffic_light_model(frame, verbose=False)
            for result in results:
                for box in result.boxes:
                    confidence = float(box.conf[0])
                    if confidence >= CONFIDENCE_THRESHOLD:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        cls_id = int(box.cls[0])
                        all_detections.append({
                            'type': 'traffic_light',
                            'class': traffic_light_model.names[cls_id],
                            'confidence': confidence,
                            'bbox': {
                                'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                                'x1_rel': x1/width, 'y1_rel': y1/height,
                                'x2_rel': x2/width, 'y2_rel': y2/height
                            }
                        })
        
        # License Plate Detection + OCR
        if lp_detector_model is not None:
            results = lp_detector_model(frame, verbose=False)
            for result in results:
                for box in result.boxes:
                    confidence = float(box.conf[0])
                    if confidence >= 0.3:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        lp_text = None
                        
                        # OCR
                        if lp_ocr_model is not None:
                            try:
                                lp_crop = frame[y1:y2, x1:x2]
                                if lp_crop.size > 0:
                                    ocr_results = lp_ocr_model(lp_crop, verbose=False)
                                    chars = []
                                    for ocr_result in ocr_results:
                                        for ocr_box in ocr_result.boxes:
                                            char_cls = int(ocr_box.cls[0])
                                            char_x = float(ocr_box.xyxy[0][0])
                                            chars.append((char_x, lp_ocr_model.names[char_cls]))
                                    chars.sort(key=lambda x: x[0])
                                    lp_text = ''.join([c[1] for c in chars])
                            except:
                                pass
                        
                        all_detections.append({
                            'type': 'license_plate',
                            'class': 'license_plate',
                            'text': lp_text,
                            'confidence': confidence,
                            'bbox': {
                                'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                                'x1_rel': x1/width, 'y1_rel': y1/height,
                                'x2_rel': x2/width, 'y2_rel': y2/height
                            }
                        })
        
        inference_time = (time.time() - start_time) * 1000
        
        return jsonify({
            'status': 'ok',
            'detections': all_detections,
            'count': len(all_detections),
            'inference_time_ms': inference_time,
            'image_size': {'width': width, 'height': height}
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def run_flask_server(port=5000):
    """Run Flask server in background thread"""
    flask_app.run(host='0.0.0.0', port=port, threaded=True, use_reloader=False)


def setup_ngrok(port=5000, authtoken=None):
    """Setup ngrok tunnel for public URL"""
    global ngrok_url
    from pyngrok import ngrok, conf
    
    if authtoken:
        ngrok.set_auth_token(authtoken)
    
    # Create tunnel
    public_url = ngrok.connect(port, "http")
    ngrok_url = public_url.public_url
    
    print("=" * 60)
    print(f"🌐 NGROK PUBLIC URL: {ngrok_url}")
    print("=" * 60)
    
    return ngrok_url


def load_models():
    """Load all YOLO models"""
    global vehicle_model, traffic_light_model, lp_detector_model, lp_ocr_model
    
    # Check GPU availability
    device = 'cpu'
    if ENABLE_GPU:
        try:
            import torch
            if torch.cuda.is_available():
                device = 'cuda'
                gpu_name = torch.cuda.get_device_name(0)
                print(f"✅ CUDA available. Using GPU: {gpu_name}")
                print(f"   CUDA version: {torch.version.cuda}")
            else:
                print("⚠️ CUDA not available. Using CPU.")
        except ImportError:
            print("⚠️ PyTorch not installed. Using CPU.")
    
    print(f"\n📦 Loading models on device: {device}")
    
    # Load Vehicle Detection Model
    try:
        if os.path.exists(VEHICLE_MODEL_PATH):
            vehicle_model = YOLO(VEHICLE_MODEL_PATH)
            vehicle_model.to(device)
            print(f"✅ Vehicle model loaded: {VEHICLE_MODEL_PATH}")
        else:
            print(f"⚠️ Vehicle model not found: {VEHICLE_MODEL_PATH}")
    except Exception as e:
        print(f"❌ Failed to load vehicle model: {e}")
    
    # Load Traffic Light Detection Model
    try:
        if os.path.exists(TRAFFIC_LIGHT_MODEL_PATH):
            traffic_light_model = YOLO(TRAFFIC_LIGHT_MODEL_PATH)
            traffic_light_model.to(device)
            print(f"✅ Traffic light model loaded: {TRAFFIC_LIGHT_MODEL_PATH}")
        else:
            print(f"⚠️ Traffic light model not found: {TRAFFIC_LIGHT_MODEL_PATH}")
    except Exception as e:
        print(f"❌ Failed to load traffic light model: {e}")
    
    # Load License Plate Detector Model
    try:
        if os.path.exists(LP_DETECTOR_MODEL_PATH):
            lp_detector_model = YOLO(LP_DETECTOR_MODEL_PATH)
            lp_detector_model.to(device)
            print(f"✅ LP detector model loaded: {LP_DETECTOR_MODEL_PATH}")
        else:
            print(f"⚠️ LP detector model not found: {LP_DETECTOR_MODEL_PATH}")
    except Exception as e:
        print(f"❌ Failed to load LP detector model: {e}")
    
    # Load License Plate OCR Model
    try:
        if os.path.exists(LP_OCR_MODEL_PATH):
            lp_ocr_model = YOLO(LP_OCR_MODEL_PATH)
            lp_ocr_model.to(device)
            print(f"✅ LP OCR model loaded: {LP_OCR_MODEL_PATH}")
        else:
            print(f"⚠️ LP OCR model not found: {LP_OCR_MODEL_PATH}")
    except Exception as e:
        print(f"❌ Failed to load LP OCR model: {e}")
    
    return vehicle_model is not None


def check_line_crossing(prev_pos, curr_pos, line_y):
    """Check if a vehicle has crossed the counting line between two positions"""
    prev_y = prev_pos[1]
    curr_y = curr_pos[1]
    
    if prev_y <= line_y and curr_y > line_y:
        return 1  # Downward crossing
    elif prev_y >= line_y and curr_y < line_y:
        return -1  # Upward crossing
    return 0  # No crossing


def process_frames_thread(camera_id):
    """Thread function to process frames for a specific camera"""
    global running, vehicle_model, traffic_light_model, lp_detector_model, lp_ocr_model
    
    # Each camera will have its own tracking/counter state
    vehicle_tracks = {}
    counted_vehicles = {}
    vehicle_counts_up = {vehicle_type: 0 for vehicle_type in VEHICLE_CLASSES}
    vehicle_counts_down = {vehicle_type: 0 for vehicle_type in VEHICLE_CLASSES}
    total_counted_up = 0
    total_counted_down = 0
    counting_line_y = None
    counting_line_start_x = None
    counting_line_end_x = None
    
    print(f"🎥 Starting frame processing thread for camera {camera_id}")
    
    while running:
        try:
            try:
                frame_data = camera_queues[camera_id].get(block=True, timeout=0.1)
                if frame_data is None:
                    time.sleep(0.01)
                    continue
            except queue.Empty:
                continue
            
            frame, cameraId, imageId, created_at, track_line_y = frame_data
            
            # Skip if no model loaded
            if vehicle_model is None:
                time.sleep(0.01)
                continue
            
            start_time = time.time()
            height, width = frame.shape[:2]
            
            # Initialize counting line
            if ENABLE_COUNTING_LINE and counting_line_y is None:
                counting_line_y = int(height * COUNTING_LINE_POSITION)
                counting_line_start_x = 0
                counting_line_end_x = width
                print(f"📏 [Camera {camera_id}] Counting line initialized at y={counting_line_y}")
            
            # ========== Run Vehicle Detection ==========
            vehicle_results = vehicle_model.track(frame, persist=True, verbose=False) if ENABLE_TRACKING else vehicle_model(frame, verbose=False)
            vehicle_detections = []
            current_tracks = {}
            vehicle_counts = {vehicle_type: 0 for vehicle_type in VEHICLE_CLASSES}
            
            for result in vehicle_results:
                boxes = result.boxes
                for box in boxes:
                    confidence = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    
                    if confidence >= CONFIDENCE_THRESHOLD:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        center_x = (x1 + x2) // 2
                        center_y = (y1 + y2) // 2
                        
                        track_id = None
                        if ENABLE_TRACKING and hasattr(box, 'id') and box.id is not None:
                            try:
                                track_id = int(box.id[0])
                            except:
                                track_id = None
                        
                        class_name = vehicle_model.names[cls_id]
                        
                        detection_info = {
                            'class': class_name,
                            'type': 'vehicle',
                            'confidence': float(confidence),
                            'bbox': {
                                'x1': float(x1 / width),
                                'y1': float(y1 / height),
                                'x2': float(x2 / width),
                                'y2': float(y2 / height),
                            }
                        }
                        
                        if track_id is not None:
                            detection_info['id'] = track_id
                            current_tracks[track_id] = {
                                'position': (center_x, center_y),
                                'time': created_at,
                                'class': class_name
                            }
                        
                        vehicle_detections.append(detection_info)
                        if class_name in vehicle_counts:
                            vehicle_counts[class_name] += 1
            
            # ========== Run Traffic Light Detection ==========
            traffic_light_detections = []
            if traffic_light_model is not None:
                tl_results = traffic_light_model(frame, verbose=False)
                for result in tl_results:
                    for box in result.boxes:
                        confidence = float(box.conf[0])
                        cls_id = int(box.cls[0])
                        
                        if confidence >= CONFIDENCE_THRESHOLD:
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            class_name = traffic_light_model.names[cls_id]
                            
                            traffic_light_detections.append({
                                'class': class_name,
                                'type': 'traffic_light',
                                'confidence': float(confidence),
                                'bbox': {
                                    'x1': float(x1 / width),
                                    'y1': float(y1 / height),
                                    'x2': float(x2 / width),
                                    'y2': float(y2 / height),
                                }
                            })
            
            # ========== Run License Plate Detection + OCR ==========
            license_plate_detections = []
            if lp_detector_model is not None:
                lp_results = lp_detector_model(frame, verbose=False)
                for result in lp_results:
                    for box in result.boxes:
                        confidence = float(box.conf[0])
                        
                        if confidence >= 0.3:  # Lower threshold for LP detection
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            
                            lp_info = {
                                'type': 'license_plate',
                                'confidence': float(confidence),
                                'bbox': {
                                    'x1': float(x1 / width),
                                    'y1': float(y1 / height),
                                    'x2': float(x2 / width),
                                    'y2': float(y2 / height),
                                },
                                'text': None
                            }
                            
                            # Run OCR on cropped license plate
                            if lp_ocr_model is not None:
                                try:
                                    lp_crop = frame[y1:y2, x1:x2]
                                    if lp_crop.size > 0:
                                        ocr_results = lp_ocr_model(lp_crop, verbose=False)
                                        # Extract text from OCR results
                                        chars = []
                                        for ocr_result in ocr_results:
                                            for ocr_box in ocr_result.boxes:
                                                char_cls = int(ocr_box.cls[0])
                                                char_x = float(ocr_box.xyxy[0][0])
                                                chars.append((char_x, lp_ocr_model.names[char_cls]))
                                        # Sort by x position and join
                                        chars.sort(key=lambda x: x[0])
                                        lp_info['text'] = ''.join([c[1] for c in chars])
                                except Exception as e:
                                    pass
                            
                            license_plate_detections.append(lp_info)
            
            # ========== Update Vehicle Tracking ==========
            current_time = time.time()
            new_crossings = []
            
            for track_id, track_info in current_tracks.items():
                current_position = track_info['position']
                current_class = track_info['class']
                
                if track_id not in vehicle_tracks:
                    vehicle_tracks[track_id] = []
                
                if ENABLE_COUNTING_LINE and len(vehicle_tracks[track_id]) > 0 and counting_line_y is not None:
                    prev_position = vehicle_tracks[track_id][-1]['position']
                    crossing_direction = check_line_crossing(prev_position, current_position, counting_line_y)
                    
                    if crossing_direction != 0:
                        crossing_key = f"{track_id}_{crossing_direction}"
                        if crossing_key not in counted_vehicles:
                            counted_vehicles[crossing_key] = True
                            
                            if crossing_direction == 1:
                                vehicle_counts_down[current_class] = vehicle_counts_down.get(current_class, 0) + 1
                                total_counted_down += 1
                            else:
                                vehicle_counts_up[current_class] = vehicle_counts_up.get(current_class, 0) + 1
                                total_counted_up += 1
                            
                            new_crossings.append((track_id, crossing_direction))
                
                vehicle_tracks[track_id].append({
                    'position': current_position,
                    'time': track_info['time'],
                    'class': current_class
                })
                
                # Keep only recent points
                vehicle_tracks[track_id] = [
                    point for point in vehicle_tracks[track_id]
                    if current_time - point['time'] <= TRAIL_DURATION
                ][-MAX_TRAIL_POINTS:]
            
            # Clean up old tracks
            for track_id in list(vehicle_tracks.keys()):
                if not vehicle_tracks[track_id] or current_time - vehicle_tracks[track_id][-1]['time'] > TRAIL_DURATION:
                    del vehicle_tracks[track_id]
            
            inference_time = (time.time() - start_time) * 1000
            
            # ========== Prepare Response ==========
            all_detections = vehicle_detections + traffic_light_detections + license_plate_detections
            
            response = {
                'camera_id': cameraId,
                'image_id': imageId,
                'track_line_y': track_line_y,
                'detections': all_detections,
                'inference_time': inference_time,
                'image_dimensions': {'width': width, 'height': height},
                'created_at': created_at,
                'vehicle_count': {
                    'total_up': total_counted_up,
                    'total_down': total_counted_down,
                    'by_type_up': vehicle_counts_up,
                    'by_type_down': vehicle_counts_down,
                    'current': vehicle_counts
                },
                'tracks': [
                    {
                        'id': track_id,
                        'positions': [{'x': p['position'][0], 'y': p['position'][1], 'time': p['time']} for p in track_data],
                        'class': track_data[-1]['class'] if track_data else None
                    }
                    for track_id, track_data in vehicle_tracks.items() if track_data
                ],
                'new_crossings': [{'id': c[0], 'direction': c[1]} for c in new_crossings]
            }
            
            # Emit results
            if sio and sio.connected and len(all_detections) > 0:
                sio.emit('car_detected', response)
            
            print(f"🔍 [Camera {camera_id}] Detected: {len(vehicle_detections)} vehicles, "
                  f"{len(traffic_light_detections)} traffic lights, "
                  f"{len(license_plate_detections)} license plates | {inference_time:.1f}ms")
            
        except Exception as e:
            print(f"❌ [Camera {camera_id}] Error: {e}")
            time.sleep(0.1)
    
    print(f"🛑 [Camera {camera_id}] Thread stopped")


def create_socketio_client(server_url):
    """Create and configure Socket.IO client"""
    global sio, connected
    
    sio = socketio.Client(
        reconnection=True,
        reconnection_attempts=0,
        reconnection_delay=1,
        reconnection_delay_max=5000,
        ssl_verify=False
    )
    
    @sio.event
    def connect():
        global connected
        connected = True
        print(f"✅ Connected to Socket.IO server: {server_url}")
        sio.emit("join_all_camera")
    
    @sio.event
    def connect_error(error):
        print(f"❌ Connection error: {error}")
    
    @sio.event
    def disconnect():
        global connected
        connected = False
        print("⚠️ Disconnected from server. Reconnecting...")
    
    @sio.on('image')
    def on_image(data):
        image = data['buffer']
        cameraId = data['cameraId']
        imageId = data['imageId']
        created_at = data['created_at']
        track_line_y = data.get('track_line_y', 0.5)
        
        try:
            if isinstance(image, dict) and 'image' in image:
                image_data = image['image']
            else:
                image_data = image
            
            if isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data
            
            img = Image.open(io.BytesIO(image_bytes))
            frame = np.array(img)
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            
            if cameraId not in camera_queues:
                camera_queues[cameraId] = queue.Queue(maxsize=10)
                t = threading.Thread(target=process_frames_thread, args=(cameraId,), daemon=True)
                camera_threads[cameraId] = t
                t.start()
            
            try:
                camera_queues[cameraId].put((frame.copy(), cameraId, imageId, created_at, track_line_y), block=False)
            except queue.Full:
                pass
        except Exception as e:
            print(f"❌ Error processing image: {e}")
    
    return sio


def maintain_connection(server_url):
    """Thread to manage Socket.IO connection"""
    global connected, running, sio
    
    while running:
        try:
            if not connected and sio:
                try:
                    print(f"🔄 Connecting to {server_url}...")
                    sio.connect(server_url, transports=['websocket'], wait=False)
                except Exception as e:
                    print(f"❌ Connection failed: {e}")
                    time.sleep(5)
            time.sleep(1)
        except Exception as e:
            print(f"❌ Connection manager error: {e}")
            time.sleep(1)


def keep_alive():
    """Keep Colab session alive"""
    while running:
        time.sleep(60)
        print(".", end="", flush=True)


def start_server(server_url, ngrok_authtoken=None):
    """
    Start the YOLO detection server
    
    Args:
        server_url: Socket.IO server URL (e.g., 'wss://your-server.com:3000')
        ngrok_authtoken: Optional ngrok auth token for public URL
    """
    global running
    
    print("=" * 60)
    print("🚀 YOLO Detection Server for Google Colab")
    print("=" * 60)
    
    # Setup ngrok if authtoken provided
    if ngrok_authtoken:
        setup_ngrok(authtoken=ngrok_authtoken)
    
    # Load models
    if not load_models():
        print("❌ Failed to load models. Check if model files exist.")
        return
    
    # Create Socket.IO client
    create_socketio_client(server_url)
    
    # Start connection manager
    conn_thread = threading.Thread(target=maintain_connection, args=(server_url,), daemon=True)
    conn_thread.start()
    print("🔌 Connection manager started")
    
    # Start keep-alive thread
    alive_thread = threading.Thread(target=keep_alive, daemon=True)
    alive_thread.start()
    print("💓 Keep-alive thread started")
    
    print("\n" + "=" * 60)
    print("✅ Server is running! Waiting for images...")
    print("=" * 60)
    
    # Keep running
    try:
        while running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping server...")
    finally:
        running = False
        if sio and sio.connected:
            sio.disconnect()
        print("👋 Server stopped.")


# ============== STEP 3: Usage Example ==============
"""
# Run this in a Colab cell:

# Option 1: Connect to your Node.js server directly
start_server(server_url='wss://your-server-ip:3000')

# Option 2: With ngrok for public URL callback
start_server(
    server_url='wss://your-server-ip:3000',
    ngrok_authtoken='your_ngrok_authtoken'  # Get from https://dashboard.ngrok.com
)
"""

if __name__ == "__main__":
    # Example: Run with your server URL
    SERVER_URL = 'wss://172.28.31.150:3000'  # Change this to your server
    start_server(server_url=SERVER_URL)
