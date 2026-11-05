"""Capture one JPEG to stdout. No preview window, filename or network connection."""
import argparse
import sys
import time

def main():
    import cv2
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', type=int, default=0)
    args = parser.parse_args()
    if args.device < 0 or args.device > 16:
        raise ValueError('Invalid camera index')
    backend = cv2.CAP_DSHOW if sys.platform == 'win32' else cv2.CAP_ANY
    camera = cv2.VideoCapture(args.device, backend)
    try:
        if not camera.isOpened():
            raise RuntimeError('Camera unavailable')
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        frame = None
        for _ in range(12):
            ok, candidate = camera.read()
            if ok:
                frame = candidate
            time.sleep(0.04)
        if frame is None:
            raise RuntimeError('Camera returned no frame')
        ok, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            raise RuntimeError('JPEG encoding failed')
        sys.stdout.buffer.write(encoded.tobytes())
    finally:
        camera.release()

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CAMERA_CAPTURE_FAILED: check camera permission/device/runtime', file=sys.stderr)
        sys.exit(1)
