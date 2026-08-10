#!/bin/bash
set -e

echo "Starting apps..."
pnpm dev > /dev/null 2>&1 &
DEV_PID=$!

echo "Waiting for apps to boot (20s)..."
sleep 20

echo "Running playwright tests..."
npx playwright test

echo "Stopping apps..."
kill -9 $DEV_PID
