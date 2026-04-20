require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const FormData = require("form-data");

// Add to package.json: "engines": { "node": ">=18" }
// OR uncomment below and run: npm install node-fetch
// const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({
  origin: "*", // replace with your domain e.g. "https://bearingsdirect.com"
  methods: ["POST", "GET"]
}));
app.use(express.json());

// ✅ Health check
app.get("/", (req, res) => res.send("RFQ Backend is running ✅"));

// ✅ File upload only route — called from frontend to avoid CORS
app.post("/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: "No file provided" });
    }

    console.log("Uploading file:", req.file.originalname, "Size:", req.file.size);

    const fileForm = new FormData();
    fileForm.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    fileForm.append("folderPath", "/rfq-uploads");
    fileForm.append("options", JSON.stringify({
      access: "PUBLIC_INDEXABLE",
      overwrite: false
    }));

    const fileResponse = await fetch("https://api.hubapi.com/files/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
        ...fileForm.getHeaders()
      },
      body: fileForm
    });

    const fileResult = await fileResponse.json();
    console.log("HubSpot file result:", fileResult);

    if (fileResponse.ok && fileResult.url) {
      return res.json({ success: true, url: fileResult.url });
    } else {
      return res.json({ success: false, message: "File upload failed", error: fileResult });
    }

  } catch (err) {
    console.error("File upload error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ Main RFQ submit route — creates HubSpot contact + handles duplicate
app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    console.log("BODY RECEIVED:", JSON.stringify(req.body));
    console.log("FILE:", req.file ? req.file.originalname : "No file");

    if (!req.body.email || !req.body.name) {
      return res.status(400).json({ success: false, message: "Email and Name are required" });
    }

    const data = {
      properties: {
        email:               req.body.email,
        firstname:           req.body.name,
        company1:            req.body.company || "",
        phone:               req.body.phone || "",
        project_description: req.body.project_description || "",
        material_type:       req.body.material_type || "",
        quantity:            req.body.quantity || "",
        timeline:            req.body.timeline || "",
        file_url:            req.body.file_url || ""  // ✅ file URL passed from frontend
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

    console.log("HubSpot Contact Response:", result);

    // ✅ Handle duplicate contact — update instead of failing
    if (!response.ok) {
      if (response.status === 409) {
        // Contact exists — update it with PATCH
        const existingEmail = req.body.email;
        const updateResponse = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingEmail}?idProperty=email`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`
            },
            body: JSON.stringify(data)
          }
        );
        const updateResult = await updateResponse.json();
        console.log("HubSpot Update Result:", updateResult);

        return res.json({
          success: true,
          message: "RFQ received — contact updated",
          hubspot: updateResult
        });
      }

      return res.status(response.status).json({
        success: false,
        message: "HubSpot error",
        error: result
      });
    }

    return res.json({
      success: true,
      message: "RFQ submitted successfully",
      file: req.body.file_url || null,
      hubspot: result
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT} 🚀`));