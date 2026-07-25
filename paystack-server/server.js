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

// ===== Vendor payout setup (Option A) =====
// These three endpoints let a vendor add their own bank account in the
// app, with no manual work from an admin in the Paystack dashboard: the
// app shows them a bank list, checks their account number really
// belongs to them, then asks Paystack to create their payout account.

// A bank dropdown needs real bank names + codes to choose from — this
// asks Paystack for Nigeria's current list rather than us hard-coding a
// list that would go stale as banks change.
app.get("/api/banks", async (req, res) => {
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: "Server isn't configured with a Paystack secret key" });
  }
  try {
    const response = await fetch("https://api.paystack.co/bank?country=nigeria", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const data = await response.json();
    if (!data.status) return res.status(502).json({ error: "Paystack couldn't return a bank list right now" });
    const banks = (data.data || []).map((b) => ({ name: b.name, code: b.code }));
    return res.json({ banks });
  } catch (err) {
    console.error("Fetching bank list failed:", err);
    return res.status(500).json({ error: "Could not reach Paystack for the bank list" });
  }
});

// Before creating a payout account, confirm the account number actually
// belongs to a real account and show the vendor the real account name —
// this is what stops a typo (or someone else's account number) from
// quietly becoming where a vendor's money gets sent.
app.get("/api/resolve-account", async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!account_number || !bank_code) {
    return res.status(400).json({ resolved: false, error: "Missing account number or bank" });
  }
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ resolved: false, error: "Server isn't configured with a Paystack secret key" });
  }
  try {
    const response = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
    const data = await response.json();
    if (!data.status || !data.data) {
      return res.json({ resolved: false, error: "Couldn't verify that account number — double check it and the bank" });
    }
    return res.json({ resolved: true, accountName: data.data.account_name });
  } catch (err) {
    console.error("Resolving account number failed:", err);
    return res.status(500).json({ resolved: false, error: "Could not reach Paystack to check this account" });
  }
});

// Creates the actual payout account Paystack will send this vendor's
// share of each sale to. percentage_charge is set to 0, meaning the main
// ProvisionGo account keeps 0% of every sale and the vendor keeps
// everything — matching the business model of earning only from the
// yearly store fee, never a cut of sales.
app.post("/api/create-subaccount", async (req, res) => {
  const { businessName, bankCode, accountNumber } = req.body || {};
  if (!businessName || !bankCode || !accountNumber) {
    return res.status(400).json({ created: false, error: "Missing business name, bank, or account number" });
  }
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ created: false, error: "Server isn't configured with a Paystack secret key" });
  }
  try {
    const response = await fetch("https://api.paystack.co/subaccount", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        business_name: businessName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: 0,
      }),
    });
    const data = await response.json();
    if (!data.status || !data.data) {
      return res.json({ created: false, error: data.message || "Paystack couldn't create this payout account" });
    }
    return res.json({ created: true, subaccountCode: data.data.subaccount_code, accountName: data.data.account_name });
  } catch (err) {
    console.error("Creating subaccount failed:", err);
    return res.status(500).json({ created: false, error: "Could not reach Paystack to create this payout account" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ProvisionGo payment server running on port ${PORT}`);
});
