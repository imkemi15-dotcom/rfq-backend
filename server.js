require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // ✅ 10MB max file size
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================
// Health check
// ======================================
app.get("/", (req, res) => {
  res.json({ status: "running" });
});

// ======================================
// Token test
// ======================================
app.get("/test-token", async (req, res) => {
  try {
    const r = await axios.get("https://api.hubapi.com/account-info/v3/details", {
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
      validateStatus: () => true,
    });
    res.json({
      token_valid: r.status === 200 ? "✅ YES" : "❌ NO - " + r.status,
      portal_id: r.data?.portalId,
    });
  } catch (e) {
    res.json({ token_valid: "❌ ERROR", error: e.message });
  }
});

// ======================================
// Main RFQ submission
// ======================================
app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  try {
    console.log("📩 Body:", req.body);
    console.log("📎 File:", req.file?.originalname || "none");

    // ======================================
    // STEP 0: reCAPTCHA verification
    // ======================================
    const recaptchaToken = req.body.recaptchaToken;

    if (recaptchaToken) {
      try {
        const captchaRes = await axios.post(
          "https://www.google.com/recaptcha/api/siteverify",
          null,
          {
            params: {
              secret: process.env.RECAPTCHA_SECRET,
              response: recaptchaToken,
            },
            validateStatus: () => true,
          }
        );

        console.log("🛡️ reCAPTCHA result:", captchaRes.data);

        // ✅ Only block very obvious bots (score < 0.1)
        // Don't block on errors — BigCommerce can cause browser-error
        if (captchaRes.data.success && captchaRes.data.score < 0.1) {
          return res.status(403).json({
            success: false,
            message: "Spam detected. Please try again.",
          });
        }
      } catch (captchaErr) {
        // ✅ Never block form if reCAPTCHA itself fails
        console.log("⚠️ reCAPTCHA check failed, continuing:", captchaErr.message);
      }
    } else {
      console.log("⚠️ No reCAPTCHA token — continuing anyway");
    }

    // ======================================
    // STEP 1: Upload file to HubSpot
    // ======================================
    let fileUrl = "";

    if (req.file) {
      try {
        console.log("📎 Uploading file:", req.file.originalname, req.file.size, "bytes");

        const fileFormData = new FormData();
        fileFormData.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
          knownLength: req.file.size,
        });
        fileFormData.append("options", JSON.stringify({
          access: "PUBLIC_INDEXABLE",
          overwrite: false,
          duplicateValidationStrategy: "NONE",
          duplicateValidationScope: "ENTIRE_PORTAL",
        }));
        fileFormData.append("folderId", "211430036516");

        const uploadRes = await axios.post(
          "https://api.hubapi.com/files/v3/files",
          fileFormData,
          {
            headers: {
              Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
              ...fileFormData.getHeaders(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: () => true,
          }
        );

        console.log("📤 Upload status:", uploadRes.status);

        if (uploadRes.status === 200 || uploadRes.status === 201) {
          fileUrl =
            uploadRes.data?.url ||
            uploadRes.data?.defaultHostingUrl || "";

          // ✅ Fallback — fetch URL by ID if not in response
          if (!fileUrl && uploadRes.data?.id) {
            const fileDetail = await axios.get(
              `https://api.hubapi.com/files/v3/files/${uploadRes.data.id}`,
              {
                headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
                validateStatus: () => true,
              }
            );
            fileUrl =
              fileDetail.data?.url ||
              fileDetail.data?.defaultHostingUrl || "";
          }

          console.log("✅ File URL:", fileUrl);
        } else {
          console.error("❌ File upload failed:", uploadRes.status, JSON.stringify(uploadRes.data));
        }
      } catch (fileErr) {
        console.error("❌ File upload exception:", fileErr.message);
      }
    }

    // ======================================
    // STEP 2: Submit HubSpot form
    // ======================================
    const portalId = "46017352";
    const formGuid = "fea88d11-c240-47a8-a280-3dc28d248ab6";

    const fields = [
      { name: "email",               value: req.body.email               || "" },
      { name: "firstname",           value: req.body.name                || "" },
      { name: "phone",               value: req.body.phone               || "" },
      { name: "company",             value: req.body.company             || "" },
      { name: "project_description", value: req.body.project_description || "" },
      { name: "material_type",       value: req.body.material_type       || "" },
      { name: "quantity",            value: req.body.quantity            || "" },
      { name: "timeline",            value: req.body.timeline            || "" },
      { name: "file_url",            value: fileUrl                           },
    ].filter(f => f.value !== "");

    console.log("📋 Submitting fields:", JSON.stringify(fields, null, 2));

    const formRes = await axios.post(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        fields,
        context: {
          pageUri: req.headers.origin || "",
          pageName: "RFQ Form",
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true,
      }
    );

    console.log("📝 Form status:", formRes.status);
    console.log("📝 Form response:", JSON.stringify(formRes.data, null, 2));

    // ======================================
    // STEP 3: Update contact directly with file_url
    // ======================================
    if (fileUrl && req.body.email) {
      try {
        // Search for contact by email
        const searchRes = await axios.post(
          "https://api.hubapi.com/crm/v3/objects/contacts/search",
          {
            filterGroups: [{
              filters: [{
                propertyName: "email",
                operator: "EQ",
                value: req.body.email,
              }],
            }],
            properties: ["email", "file_url"],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            validateStatus: () => true,
          }
        );

        const contactId = searchRes.data?.results?.[0]?.id;
        console.log("🔍 Contact ID found:", contactId);

        if (contactId) {
          const updateRes = await axios.patch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
              properties: { file_url: fileUrl },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              validateStatus: () => true,
            }
          );
          console.log("✏️ Contact update status:", updateRes.status);
          if (updateRes.status === 200) {
            console.log("✅ file_url saved to contact successfully!");
          }
        } else {
          console.log("⚠️ Contact not found yet — file_url saved via form fields");
        }
      } catch (updateErr) {
        console.error("❌ Contact update error:", updateErr.message);
      }
    }

    // ======================================
    // SUCCESS
    // ======================================
    return res.status(200).json({
      success: true,
      message: "RFQ submitted successfully 🎉",
      file_url: fileUrl,
    });

  } catch (error) {
    console.error("💥 FATAL ERROR:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ======================================
// Global error handler
// ======================================
app.use((err, req, res, next) => {
  console.error("💥 EXPRESS ERROR:", err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ======================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
