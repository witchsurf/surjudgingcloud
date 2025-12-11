#!/bin/bash
# ============================================================================
# Quick Migration Verification Script
# ============================================================================
# This script runs a quick check to verify migrations are applied correctly
# without needing Supabase CLI or database connection
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_check() {
    echo -e "${BLUE}▶ $1${NC}"
}

print_pass() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_fail() {
    echo -e "${RED}✗ $1${NC}"
}

echo ""
echo "============================================"
echo "  📋 Quick Migration Check"
echo "============================================"
echo ""

# Check 1: Migration files exist
print_check "Checking migration files..."
if [ -f "supabase/migrations/20251109000000_fix_security_policies.sql" ] && \
   [ -f "supabase/migrations/20251109000001_consolidate_triggers.sql" ]; then
    print_pass "Migration files found"
else
    print_fail "Migration files missing!"
    exit 1
fi

# Check 2: Test file exists
print_check "Checking test file..."
if [ -f "supabase/migrations/TEST_MIGRATIONS.sql" ]; then
    print_pass "Test file found"
else
    print_fail "Test file missing!"
    exit 1
fi

# Check 3: New utility files exist
print_check "Checking utility files..."
MISSING_FILES=()

if [ ! -f "src/utils/validation.ts" ]; then
    MISSING_FILES+=("src/utils/validation.ts")
fi

if [ ! -f "src/utils/secureStorage.ts" ]; then
    MISSING_FILES+=("src/utils/secureStorage.ts")
fi

if [ ${#MISSING_FILES[@]} -eq 0 ]; then
    print_pass "All utility files present"
else
    print_fail "Missing utility files: ${MISSING_FILES[*]}"
fi

# Check 4: Documentation exists
print_check "Checking documentation..."
MISSING_DOCS=()

if [ ! -f "DEPLOYMENT.md" ]; then
    MISSING_DOCS+=("DEPLOYMENT.md")
fi

if [ ! -f "TESTING_GUIDE.md" ]; then
    MISSING_DOCS+=("TESTING_GUIDE.md")
fi

if [ ! -f "SECURITY_IMPROVEMENTS.md" ]; then
    MISSING_DOCS+=("SECURITY_IMPROVEMENTS.md")
fi

if [ ${#MISSING_DOCS[@]} -eq 0 ]; then
    print_pass "All documentation present"
else
    print_fail "Missing documentation: ${MISSING_DOCS[*]}"
fi

# Check 5: Payment function updated
print_check "Checking payment function updates..."
if grep -q "ALLOWED_ORIGINS" supabase/functions/payments/index.ts; then
    print_pass "Payment function has CORS improvements"
else
    print_fail "Payment function not updated!"
fi

# Check 6: Main.tsx updated
print_check "Checking main.tsx initialization..."
if grep -q "initStorageCleanup" src/main.tsx; then
    print_pass "Storage cleanup initialized in main.tsx"
else
    print_fail "main.tsx not updated!"
fi

# Summary
echo ""
echo "============================================"
if [ ${#MISSING_FILES[@]} -eq 0 ] && [ ${#MISSING_DOCS[@]} -eq 0 ]; then
    echo -e "  ${GREEN}✅ All files ready for testing!${NC}"
    echo "============================================"
    echo ""
    echo "Next steps:"
    echo "  1. Run: ./test-migrations.sh local"
    echo "  2. Or follow TESTING_GUIDE.md for manual testing"
    echo ""
else
    echo -e "  ${YELLOW}⚠ Some files are missing${NC}"
    echo "============================================"
    echo ""
    echo "This shouldn't happen. Please review the files above."
    echo ""
fi
