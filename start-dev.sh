#!/bin/bash

echo "🚀 Starting Money Circle DEV Environment..."

# 1. Install root dependencies (for Tact compiler)
if [ ! -d "node_modules" ]; then
  echo "📦 Installing root dependencies..."
  npm install
fi

# 2. Compile Contracts (Important for ABIs)
echo "🛠 Compiling Smart Contracts..."
npx tact --config tact.config.json

# 3. Setup Mini App
echo "📱 Setting up Mini App..."
cd miniapp

if [ ! -d "node_modules" ]; then
  echo "📦 Installing Mini App dependencies..."
  npm install
fi

# 4. Create .env.local for Mock Mode if not exists
if [ ! -f ".env.local" ]; then
  echo "📝 Creating .env.local for Mock Mode..."
  # Empty VITE_FUNCTIONS_BASE_URL triggers Mock Mode in our code
  echo "VITE_FUNCTIONS_BASE_URL=" > .env.local
  echo "VITE_IS_DEV=true" >> .env.local
fi

# 5. Run Vite
echo "✅ Ready! Starting Frontend on http://localhost:5173"
echo "👉 You can now open your browser. The app will simulate a backend."
npm run dev
