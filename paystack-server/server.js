// ProvisionGo payment server
//
// This exists for one reason: never trust a payment popup on its own.
// The app's checkout and vendor-renewal screens call this server after
// Paystack's popup reports "success" — but a "success" message from
// someone's own browser could be faked. This server asks Paystack
// directly, using the SECRET key (which must never live in the app
// itself), whether a payment actually went through before the app is
// allowed to mark anything as paid.

// This line reads your .env file and loads PAYSTACK_SECRET_KEY into the
// program — without it, Node has no idea the .env file even exists.
import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors()); // Locking this down to your real app's domain (see README) is worth doing once you're live with real money.
app.use(express.json());

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.error("Missing PAYSTACK_SECRET_KEY environment variable — set this before starting the server.");
}

// Health check — visiting this URL in a browser should just say "ok".
// Useful for confirming the server is actually deployed and awake.
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "ProvisionGo payment server" });
});

// The app calls this with a Paystack payment reference. We ask Paystack
// directly (server-to-server, using the secret key) whether that
// reference is a genuine, successful, completed payment — the app never
// has to be trusted on this by itself.
app.get("/api/verify/:reference", async (req, res) => {
  const { reference } = req.params;
  if (!reference) {
    return res.status(400).json({ verified: false, error: "Missing payment reference" });
  }
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ verified: false, error: "Server isn't configured with a Paystack secret key" });
  }
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const data = await response.json();

    if (!data.status || !data.data) {
      return res.json({ verified: false, error: "Paystack could not find this payment" });
    }

    const isSuccessful = data.data.status === "success";
    return res.json({
      verified: isSuccessful,
      amount: data.data.amount ? data.data.amount / 100 : null, // Paystack returns kobo; convert back to naira
      currency: data.data.currency,
      paidAt: data.data.paid_at,
      metadata: data.data.metadata || null,
    });
  } catch (err) {
    console.error("Paystack verification request failed:", err);
    return res.status(500).json({ verified: false, error: "Could not reach Paystack to verify this payment" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ProvisionGo payment server running on port ${PORT}`);
});
