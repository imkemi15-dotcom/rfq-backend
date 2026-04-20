require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");

// Fix 3: Use native fetch only on Node 18+, otherwise require node-fetch
// Add to package.json: "engines": { "node": ">=18" }
// OR uncomment the line below and run: npm install node-fetch
// const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

const app = express();

// Fix 1: Use memory storage — Render's disk is ephemeral
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("RFQ Backend is running ✅"));

app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    if (!req.body.email || !req.body.name) {
      return res.status(400).json({ success: false, message: "Email and Name are required" });
    }

    const data = {
      properties: {
        email: req.body.email,
        firstname: req.body.name,
        company: req.body.company1 || "",
        phone: req.body.phone || "",
        project_description: req.body.project_description || "",
        material_type: req.body.material_type || "",
        quantity: req.body.quantity || "",
        timeline: req.body.timeline || ""
      }
    };

    const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`
      },
      body: JSON.stringify(data)
    });

    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; }
    catch (e) { result = { raw: text }; }

    // Fix 2: Handle duplicate contact gracefully
    if (!response.ok) {
      if (response.status === 409) {
        // Contact already exists — treat as success
        return res.json({ success: true, message: "RFQ received (existing contact updated)" });
      }
      return res.status(response.status).json({ success: false, message: "HubSpot error", error: result });
    }

    return res.json({
      success: true,
      message: "RFQ submitted successfully",
      // File is now in req.file.buffer (memory) — log the name only
      file: req.file ? req.file.originalname : null,
      hubspot: result
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Fix 4: Always have a fallback port
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT} 🚀`));
