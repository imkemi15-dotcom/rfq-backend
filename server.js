require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const FormData = require("form-data");

const app = express();

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("RFQ Backend is running ✅");
});

app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    console.log("📩 Incoming body:", req.body);
    console.log("📎 File received:", req.file ? req.file.originalname : "No file");

    let fileUrl = "";

    // ======================================
    // STEP 1: Upload file to HubSpot (if exists)
    // ======================================
    if (req.file) {
      const formData = new FormData();

      // ✅ Correct way to append buffer with metadata
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        knownLength: req.file.size,
      });

      // ✅ No folder needed — uploads to root
      formData.append(
        "options",
        JSON.stringify({
          access: "PUBLIC_INDEXABLE",
          overwrite: false,
          duplicateValidationStrategy: "NONE",
          duplicateValidationScope: "ENTIRE_PORTAL",
        })
      );

      console.log("⬆️ Uploading file to HubSpot...");

      const uploadRes = await fetch("https://api.hubapi.com/files/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
          ...formData.getHeaders(),
        },
        body: formData,
      });

      const uploadData = await uploadRes.json();

      console.log("📤 HubSpot Upload Status:", uploadRes.status);
      console.log("📤 HubSpot Upload Response:", JSON.stringify(uploadData, null, 2));

      if (uploadRes.ok && uploadData.url) {
        fileUrl = uploadData.url;
        console.log("✅ File uploaded successfully:", fileUrl);
      } else {
        // ✅ Don't block form submission if file upload fails — just log it
        console.error("❌ File upload failed:", uploadData);
      }
    }

    // ======================================
    // STEP 2: Submit form to HubSpot
    // ======================================
    const portalId = "46017352";
    const formGuid = "fea88d11-c240-47a8-a280-3dc28d248ab6";

    // ✅ Only send fields that actually exist in HubSpot as Contact properties
const formPayload = {
  fields: [
    { name: "email",               value: req.body.email               || "" },
    { name: "firstname",           value: req.body.name                || "" },
    { name: "phone",               value: req.body.phone               || "" },
    { name: "company",             value: req.body.company             || "" },
    { name: "project_description", value: req.body.project_description || "" },
    { name: "material_type",       value: req.body.material_type       || "" },
    { name: "quantity",            value: req.body.quantity            || "" },
    { name: "timeline",            value: req.body.timeline            || "" },
    { name: "file_url",            value: fileUrl                           },
  ].filter(field => field.value !== ""), // ✅ removes empty fields entirely
  context: {
    pageUri: req.headers.origin || "",
    pageName: "RFQ Form",
  },
};

    console.log("📋 Submitting to HubSpot form...");
    console.log("📋 file_url value being sent:", fileUrl);

    const formRes = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formPayload),
      }
    );

    const formText = await formRes.text();
    console.log("📝 Form Submit Status:", formRes.status);
    console.log("📝 Form Submit Response:", formText);

    if (!formRes.ok) {
      return res.status(400).json({
        success: false,
        message: "Form submission failed",
        error: formText,
      });
    }

    return res.json({
      success: true,
      message: "RFQ submitted successfully 🎉",
      file_url: fileUrl,
    });

  } catch (error) {
    console.error("💥 SERVER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
