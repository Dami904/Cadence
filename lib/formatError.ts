// Maps the raw errors wagmi/viem throw (often a multi-line stack dump as .message, with the
// actually-useful part in .shortMessage) into copy a non-crypto-native member can act on,
// instead of surfacing that dump directly in the UI.
export function formatWriteError(error: Error | null | undefined): string | null {
  if (!error) return null;

  const shortMessage = "shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : undefined;
  const name = error.name ?? "";
  const text = `${name} ${shortMessage ?? error.message ?? ""}`.toLowerCase();

  if (text.includes("user rejected") || text.includes("userrejected")) {
    return "You cancelled the request in your wallet.";
  }
  if (text.includes("insufficient funds")) {
    return "Your wallet doesn't have enough Base Sepolia ETH to cover gas for this step.";
  }
  if (text.includes("chain") && (text.includes("mismatch") || text.includes("does not match") || text.includes("unsupported"))) {
    return "Your wallet is on the wrong network — switch to Base Sepolia and try again.";
  }
  if (text.includes("exceeds allowance") || text.includes("insufficient allowance")) {
    return "That amount isn't approved yet — approve it and try again.";
  }
  if (text.includes("exceeds balance") || text.includes("transfer amount exceeds balance")) {
    return "Your wallet doesn't have enough test USDC for this action.";
  }
  if (text.includes("nonce")) {
    return "That request is out of date — refresh and try again.";
  }

  return shortMessage ?? "Something went wrong submitting that transaction. Try again.";
}
