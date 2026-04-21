require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const FormData = require("form-data");

const app = express();

// ✅ Use memory storage (important for Render)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// ✅ Test route
app.get("/", (req, res) => {
  res.send("RFQ Backend is running ✅");
});

// ✅ RFQ API
app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    console.log("Incoming:", req.body);
    console.log("File:", req.file ? req.file.originalname : "No file");

    // ✅ Validation
    if (!req.body.email || !req.body.name) {
      return res.status(400).json({
        success: false,
        message: "Email and Name are required"
      });
    }

    let fileUrl = "";

    // ================================
    // ✅ STEP 1: Upload file to HubSpot
    // ================================
    if (req.file) {
      const formData = new FormData();

      formData.append("file", req.file.buffer, req.file.originalname);
      formData.append(
        "options",
        JSON.stringify({
          access: "PUBLIC_NOT_INDEXABLE"
        })
      );
      formData.append("folderPath", "/rfq-uploads");

      const uploadRes = await fetch(
        "https://api.hubapi.com/files/v3/files",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`
          },
          body: formData
        }
      );

      const uploadText = await uploadRes.text();

      let uploadData;
      try {
        uploadData = uploadText ? JSON.parse(uploadText) : {};
      } catch {
        uploadData = { raw: uploadText };
      }

      console.log("File Upload Response:", uploadData);

      if (uploadRes.ok && uploadData.url) {
        fileUrl = uploadData.url;
      }
    }

    // ================================
    // ✅ STEP 2: Create/Update Contact
    // ================================
    const contactData = {
      properties: {
        email: req.body.email,
        firstname: req.body.name,
        company: req.body.company || "",
        phone: req.body.phone || "",
        project_description: req.body.project_description || "",
        material_type: req.body.material_type || "",
        quantity: req.body.quantity || "",
        timeline: req.body.timeline || "",
        file_url: fileUrl // 🔥 important
      }
    };

    const response = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?idProperty=email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`
        },
        body: JSON.stringify(contactData)
      }
    );

    const text = await response.text();

    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { raw: text };
    }

    console.log("HubSpot Response:", result);

    // ================================
    // ✅ STEP 3: Handle duplicate contact
    // ================================
    if (!response.ok) {
      if (response.status === 409) {
        return res.json({
          success: true,
          message: "RFQ received (existing contact updated)",
          file_url: fileUrl
        });
      }

      return res.status(response.status).json({
        success: false,
        message: "HubSpot error",
        error: result
      });
    }

    // ================================
    // ✅ SUCCESS RESPONSE
    // ================================
    return res.json({
      success: true,
      message: "RFQ submitted successfully",
      file_url: fileUrl,
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
