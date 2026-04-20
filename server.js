require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const FormData = require("form-data");
const https = require("https");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Fix CORS
app.use(cors({
  origin: "*",
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());
app.use(express.json());

// ✅ Keep Render awake (pings every 14 min)
setInterval(() => {
  https.get("https://rfq-backend-py0w.onrender.com", (res) => {
    console.log("Keep-alive ping:", res.statusCode);
  }).on("error", () => {});
}, 14 * 60 * 1000);

// ✅ Health check
app.get("/", (req, res) => res.send("RFQ Backend is running ✅"));

// ✅ File upload route — uploads file to HubSpot File Manager
app.post("/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: "No file provided" });
    }

    console.log("Uploading file:", req.file.originalname, "| Size:", req.file.size);

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
      return res.json({
        success: false,
        message: "File upload failed",
        error: fileResult
      });
    }

  } catch (err) {
    console.error("File upload error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ RFQ submit route — creates or updates HubSpot contact
app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    console.log("BODY RECEIVED:", JSON.stringify(req.body));
    console.log("FILE:", req.file ? req.file.originalname : "No file");

    // Validate required fields
    if (!req.body.email || !req.body.name) {
      return res.status(400).json({
        success: false,
        message: "Email and Name are required"
      });
    }

    const data = {
      properties: {
        email:               req.body.email,
        firstname:           req.body.name,
        company1:            req.body.company  || "",
        phone:               req.body.phone    || "",
        project_description: req.body.project_description || "",
        material_type:       req.body.material_type       || "",
        quantity:            req.body.quantity            || "",
        timeline:            req.body.timeline            || "",
        file_url:            req.body.file_url            || ""
      }
    };

    // Try to create new contact
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

    // Handle duplicate contact — update instead of failing
    if (!response.ok) {
      if (response.status === 409) {
        console.log("Contact exists — updating:", req.body.email);

        const updateResponse = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${req.body.email}?idProperty=email`,
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

      // Other HubSpot errors
      return res.status(response.status).json({
        success: false,
        message: "HubSpot error",
        error: result
      });
    }

    // Success — new contact created
    return res.json({
      success: true,
      message: "RFQ submitted successfully",
      file: req.body.file_url || null,
      hubspot: result
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT} 🚀`));
