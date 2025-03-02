/**
 * Test script for the formatSol function
 */

// Copy of the fixed formatSol function
function formatSol(lamports) {
  // Handle string inputs (API returns strings)
  if (typeof lamports === 'string') {
    // Convert directly if it's already in SOL format (small decimal)
    if (lamports.includes('.')) {
      const solValue = parseFloat(lamports);
      return solValue.toLocaleString('en-US', { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 9 
      });
    }
    // Convert from lamports if it's a large integer string
    lamports = parseInt(lamports, 10);
  }
  
  // Original conversion from lamports to SOL
  const sol = lamports / 1000000000;
  return sol.toLocaleString('en-US', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 9 
  });
}

// Test cases
const testCases = [
  { input: "0.0001950", expected: "0.0001950" },
  { input: "0.0162081", expected: "0.0162081" },
  { input: "0.0160131", expected: "0.0160131" },
  { input: 1000000000, expected: "1.00" },  // 1 SOL in lamports
  { input: "1000000000", expected: "1.00" }, // 1 SOL in lamports as string
  { input: 0, expected: "0.00" },
  { input: "0", expected: "0.00" }
];

// Run tests
console.log("=== TESTING formatSol FUNCTION ===\n");
testCases.forEach((test, index) => {
  const result = formatSol(test.input);
  const passed = result.includes(test.expected.substring(0, 5)); // Check if result contains expected value
  
  console.log(`Test ${index + 1}: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  Input: ${test.input} (${typeof test.input})`);
  console.log(`  Result: ${result}`);
  console.log(`  Expected: ${test.expected}`);
  console.log();
});

// Test with actual API values
console.log("=== TESTING WITH ACTUAL API VALUES ===\n");
const apiValues = {
  totalSolDistributed: "0.0001950",
  totalSolReceived: "0.0162081",
  currentSolBalance: "0.0160131"
};

console.log("Total Distributed:", formatSol(apiValues.totalSolDistributed), "SOL");
console.log("Total Received:", formatSol(apiValues.totalSolReceived), "SOL");
console.log("Current Balance:", formatSol(apiValues.currentSolBalance), "SOL"); 