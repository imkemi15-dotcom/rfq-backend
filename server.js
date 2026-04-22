require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ✅ IMPORTANT FIX

app.get("/", (req, res) => {
  res.json({ status: "running" });
});

// ======================================
// TEST HUBSPOT TOKEN
// ======================================
app.get("/test-token", async (req, res) => {
  const results = {};
  try {
    const r1 = await axios.get("https://api.hubapi.com/account-info/v3/details", {
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
      validateStatus: () => true,
    });
    results.token_valid = r1.status === 200 ? "✅ YES" : "❌ NO - " + r1.status;
    results.portal_id = r1.data?.portalId;
  } catch (e) {
    results.token_valid = "❌ ERROR: " + e.message;
  }
  res.json(results);
});

// ======================================
// MAIN RFQ ROUTE
// ======================================
app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  try {
    console.log("📩 Body:", req.body);
    console.log("📎 File:", req.file?.originalname || "none");

    // ======================================
    // STEP 0: VERIFY reCAPTCHA
    // ======================================
    const token = req.body.recaptchaToken;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "reCAPTCHA token missing",
      });
    }

    try {
      const verifyRes = await axios.post(
        "https://www.google.com/recaptcha/api/siteverify",
        null,
        {
          params: {
            secret: process.env.RECAPTCHA_SECRET,
            response: token,
          },
        }
      );

      console.log("🛡️ reCAPTCHA:", verifyRes.data);

      if (
        !verifyRes.data.success ||
        verifyRes.data.score < 0.5 || // 🔥 adjust if needed
        verifyRes.data.action !== "submit"
      ) {
        return res.status(403).json({
          success: false,
          message: "Spam detected ❌",
          score: verifyRes.data.score,
        });
      }

    } catch (captchaError) {
      console.error("❌ reCAPTCHA Error:", captchaError.message);
      return res.status(500).json({
        success: false,
        message: "reCAPTCHA verification failed",
      });
    }

    let fileUrl = "";

    // ======================================
    // STEP 1: Upload file to HubSpot
    // ======================================
    if (req.file) {
      try {
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

        console.log("📤 Upload Status:", uploadRes.status);

        if (uploadRes.status === 200 || uploadRes.status === 201) {
          fileUrl =
            uploadRes.data?.url ||
            uploadRes.data?.defaultHostingUrl ||
            uploadRes.data?.cdn_url || "";

          if (!fileUrl && uploadRes.data?.id) {
            const fileDetail = await axios.get(
              `https://api.hubapi.com/files/v3/files/${uploadRes.data.id}`,
              {
                headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
              }
            );

            fileUrl =
              fileDetail.data?.url ||
              fileDetail.data?.defaultHostingUrl || "";
          }

          console.log("✅ Final fileUrl:", fileUrl);
        } else {
          console.error("❌ Upload failed:", uploadRes.status, uploadRes.data);
        }

      } catch (fileError) {
        console.error("❌ File upload exception:", fileError.message);
      }
    }

    // ======================================
    // STEP 2: Submit HubSpot form
    // ======================================
    const portalId = "46017352";
    const formGuid = "fea88d11-c240-47a8-a280-3dc28d248ab6";

    const fields = [
      { name: "email", value: req.body.email || "" },
      { name: "firstname", value: req.body.name || "" },
      { name: "phone", value: req.body.phone || "" },
      { name: "company", value: req.body.company || "" },
      { name: "project_description", value: req.body.project_description || "" },
      { name: "material_type", value: req.body.material_type || "" },
      { name: "quantity", value: req.body.quantity || "" },
      { name: "timeline", value: req.body.timeline || "" },
      { name: "file_url", value: fileUrl },
    ].filter(f => f.value !== "");

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

    console.log("📝 Form Status:", formRes.status);

    // ======================================
    // STEP 3: Update contact
    // ======================================
    if (fileUrl && req.body.email) {
      try {
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
          }
        );

        const contactId = searchRes.data?.results?.[0]?.id;

        if (contactId) {
          await axios.patch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
              properties: { file_url: fileUrl },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
                "Content-Type": "application/json",
              },
            }
          );

          console.log("✅ Contact updated");
        }

      } catch (err) {
        console.error("❌ Contact update error:", err.message);
      }
    }

    if (formRes.status !== 200) {
      return res.status(400).json({
        success: false,
        message: "Form submission failed",
        error: formRes.data,
      });
    }

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
app.use((err, req, res, next) => {
  console.error("💥 EXPRESS ERROR:", err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ======================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
