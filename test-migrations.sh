#!/bin/bash
# ============================================================================
# Migration Testing Script
# ============================================================================
# This script helps you test the security and performance migrations
# Usage: ./test-migrations.sh [local|remote]
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Header
echo ""
echo "============================================"
echo "  🧪 Migration Testing Script"
echo "============================================"
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    print_error "Supabase CLI not found!"
    echo "Install it with: npm install -g supabase"
    exit 1
fi
print_success "Supabase CLI found"

# Determine environment
ENV=${1:-"local"}

if [ "$ENV" = "local" ]; then
    print_step "Testing against LOCAL Supabase instance"

    # Check if local Supabase is running
    if ! supabase status &> /dev/null; then
        print_warning "Local Supabase not running. Starting it..."
        supabase start
    else
        print_success "Local Supabase is running"
    fi

    # Get connection string
    DB_URL=$(supabase status -o json | grep "DB URL" | cut -d'"' -f4)

elif [ "$ENV" = "remote" ]; then
    print_step "Testing against REMOTE Supabase instance"

    # Check if project is linked
    if [ ! -f .git/modules/supabase/.git/config ] && [ ! -f .supabase/config.toml ]; then
        print_error "Not linked to a Supabase project!"
        echo ""
        echo "Link your project first:"
        echo "  supabase link --project-ref YOUR_PROJECT_REF"
        exit 1
    fi

    print_success "Project linked"

else
    print_error "Invalid environment: $ENV"
    echo "Usage: ./test-migrations.sh [local|remote]"
    exit 1
fi

echo ""
print_step "Step 1: Checking current migration status"
echo ""

# List applied migrations
supabase migration list

echo ""
print_step "Step 2: Applying migrations"
echo ""

# Apply migrations
if supabase db push; then
    print_success "Migrations applied successfully"
else
    print_error "Failed to apply migrations"
    exit 1
fi

echo ""
print_step "Step 3: Running test suite"
echo ""

# Run the test suite
if supabase db execute -f supabase/migrations/TEST_MIGRATIONS.sql; then
    print_success "Test suite completed successfully"
else
    print_error "Test suite failed"
    echo ""
    echo "Check the output above for details."
    echo "You may need to:"
    echo "  1. Review TESTING_GUIDE.md for manual testing"
    echo "  2. Check Supabase logs for errors"
    echo "  3. Verify your database permissions"
    exit 1
fi

echo ""
echo "============================================"
echo "  ${GREEN}✅ ALL TESTS PASSED!${NC}"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Review the output above for any warnings"
echo "  2. Test the application manually"
echo "  3. Check DEPLOYMENT.md for production deployment"
echo ""
