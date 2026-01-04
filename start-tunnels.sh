#!/bin/bash

# Kill existing cloudflared quick tunnel processes to avoid clutter (optional, comment out if unwanted)
pkill -f "cloudflared tunnel --url"

echo "Starting Cloudflare Tunnel for Port 3000..."
nohup cloudflared tunnel --url http://localhost:3000 > tunnel_3000.log 2>&1 &
PID_3000=$!

echo "Starting Cloudflare Tunnel for Port 8000..."
nohup cloudflared tunnel --url http://localhost:8000 > tunnel_8000.log 2>&1 &
PID_8000=$!

echo "Tunnels started in background (PIDs: $PID_3000, $PID_8000)."
echo "Waiting for URLs to be generated..."
sleep 5

echo "----------------------------------------"
echo "Tunnel URLs for Port 3000:"
grep -o 'https://.*\.trycloudflare\.com' tunnel_3000.log | head -n 1
echo "----------------------------------------"
echo "Tunnel URLs for Port 8000:"
grep -o 'https://.*\.trycloudflare\.com' tunnel_8000.log | head -n 1
echo "----------------------------------------"

echo "Logs are being saved to tunnel_3000.log and tunnel_8000.log"
echo "Use 'tail -f tunnel_3000.log' or 'tail -f tunnel_8000.log' to monitor."
