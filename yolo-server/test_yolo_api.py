#!/usr/bin/env python3
"""
Test script for YOLO REST API
Usage: python test_yolo_api.py <API_URL> [IMAGE_PATH]

Example:
  python test_yolo_api.py https://xxx.trycloudflare.com
  python test_yolo_api.py https://xxx.trycloudflare.com ./test_image.jpg
"""

import requests
import sys
import time
import os

def test_health(api_url: str) -> bool:
    """Test /health endpoint"""
    print("\n🔍 Testing /health...")
    try:
        resp = requests.get(f"{api_url}/health", timeout=10)
        print(f"   Status: {resp.status_code}")
        if resp.ok:
            data = resp.json()
            print(f"   ✅ Models: V={data['models']['vehicle']} TL={data['models']['traffic_light']} LP={data['models']['license_plate']}")
            print(f"   Device: {data['device']}")
            return True
        else:
            print(f"   ❌ Error: {resp.text}")
            return False
    except Exception as e:
        print(f"   ❌ Connection failed: {e}")
        return False


def test_detect(api_url: str, image_path: str = None) -> bool:
    """Test /detect endpoint"""
    print("\n🔍 Testing /detect...")
    
    # Use a sample image or generate one
    if image_path and os.path.exists(image_path):
        print(f"   Using image: {image_path}")
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
    else:
        print("   Using generated test image (640x480 black)")
        import io
        try:
            from PIL import Image
            img = Image.new('RGB', (640, 480), color='black')
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG')
            image_bytes = buffer.getvalue()
        except ImportError:
            # Create minimal JPEG without PIL
            print("   ⚠️ PIL not installed, using minimal test data")
            # Create a minimal valid JPEG (1x1 black pixel)
            image_bytes = bytes([
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
                0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
                0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
                0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
                0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
                0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
                0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
                0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
                0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
                0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
                0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
                0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
                0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
                0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
                0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
                0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
                0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
                0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
                0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
                0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
                0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
                0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
                0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
                0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
                0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
                0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xFF, 0xD9
            ])
    
    try:
        start = time.time()
        files = {'image': ('test.jpg', image_bytes, 'image/jpeg')}
        data = {
            'camera_id': 'test-camera',
            'track_line_y': '50',
            'created_at': str(int(time.time() * 1000))
        }
        resp = requests.post(f"{api_url}/detect", files=files, data=data, timeout=60)
        elapsed = (time.time() - start) * 1000
        
        print(f"   Status: {resp.status_code}")
        print(f"   Total time: {elapsed:.0f}ms")
        
        if resp.ok:
            result = resp.json()
            print(f"   ✅ Response received")
            
            if 'vehicle' in result:
                v = result['vehicle']
                print(f"   Vehicles: {len(v.get('detections', []))} detected")
                print(f"   Inference: {v.get('inference_time', 0):.1f}ms")
                print(f"   Counts: ↑{v['vehicle_count']['total_up']} ↓{v['vehicle_count']['total_down']}")
            
            if 'traffic_light' in result:
                tl = result['traffic_light']
                print(f"   Traffic Light: {tl.get('traffic_status', 'N/A')}")
                print(f"   TL Inference: {tl.get('inference_time', 0):.1f}ms")
            
            return True
        else:
            print(f"   ❌ Error: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"   ❌ Request failed: {e}")
        return False


def test_detect_lp(api_url: str, image_path: str = None) -> bool:
    """Test /detect/lp endpoint"""
    print("\n🔍 Testing /detect/lp...")
    
    if image_path and os.path.exists(image_path):
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
    else:
        print("   Skipping (no image with license plate)")
        return True
    
    try:
        files = {'image': ('test.jpg', image_bytes, 'image/jpeg')}
        data = {'detections': '[]'}
        resp = requests.post(f"{api_url}/detect/lp", files=files, data=data, timeout=60)
        
        print(f"   Status: {resp.status_code}")
        if resp.ok:
            result = resp.json()
            print(f"   ✅ License plates: {result.get('license_plates', {})}")
            print(f"   Inference: {result.get('inference_time', 0):.1f}ms")
            return True
        else:
            print(f"   ❌ Error: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"   ❌ Request failed: {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_yolo_api.py <API_URL> [IMAGE_PATH]")
        print("Example: python test_yolo_api.py https://xxx.trycloudflare.com")
        sys.exit(1)
    
    api_url = sys.argv[1].rstrip('/')
    image_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    print(f"═" * 50)
    print(f"🧪 Testing YOLO API: {api_url}")
    print(f"═" * 50)
    
    results = {
        'health': test_health(api_url),
        'detect': test_detect(api_url, image_path),
        'detect_lp': test_detect_lp(api_url, image_path)
    }
    
    print(f"\n{'═' * 50}")
    print("📊 Results:")
    for name, passed in results.items():
        print(f"   {name}: {'✅ PASS' if passed else '❌ FAIL'}")
    
    passed = sum(results.values())
    total = len(results)
    print(f"\n   Total: {passed}/{total} tests passed")
    print(f"{'═' * 50}")
    
    sys.exit(0 if passed == total else 1)


if __name__ == '__main__':
    main()
