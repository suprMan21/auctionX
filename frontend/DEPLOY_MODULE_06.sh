#!/bin/bash

# Module 06 Deployment Script
# Run this from your project root: bash frontend/DEPLOY_MODULE_06.sh

set -e

echo "🚀 AuctionX Module 06 Deployment"
echo "================================"
echo ""

# Verify we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from frontend/ directory"
    exit 1
fi

echo "📦 Installing new dependencies..."
npm install

echo ""
echo "🔧 Installing Playwright browsers..."
npx playwright install chromium firefox webkit

echo ""
echo "📝 Creating .env from .env.example if it doesn't exist..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "⚠️  Please edit .env with your actual values"
else
    echo "✅ .env already exists"
fi

echo ""
echo "✅ Module 06 files are ready!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env with your Supabase and AWS credentials"
echo "2. Run: npm run test:preflight"
echo "3. Run: npm run test:integration"
echo "4. Run: npm run dev (in one terminal)"
echo "5. Run: npm run test:e2e (in another terminal)"
echo ""
echo "📖 Read TEST_README.md for complete testing guide"
echo ""
echo "🎉 Module 06 deployment complete!"
