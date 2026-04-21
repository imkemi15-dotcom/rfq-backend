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

app.get("/", (req, res) => {
  res.json({ status: "running" });
});

// ✅ Completely new test route
app.get("/test-token", async (req, res) => {
  const results = {};

  // Test 1: Basic token check
  try {
    const r1 = await axios.get("https://api.hubapi.com/account-info/v3/details", {
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
      validateStatus: () => true,
    });
    results.token_check = { status: r1.status, data: r1.data };
  } catch (e) {
    results.token_check = { error: e.message };
  }

  // Test 2: Files scope check using POST search
  try {
    const r2 = await axios.post(
      "https://api.hubapi.com/files/v3/files/search",
      { limit: 1 },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      }
    );
    results.files_scope = {
      status: r2.status,
      works: r2.status === 200,
      data: r2.data
    };
  } catch (e) {
    results.files_scope = { error: e.message };
  }

  res.json(results);
});

app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  try {
    console.log("📩 Body:", req.body);
    console.log("📎 File:", req.file?.originalname || "none");

    let fileUrl = "";

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

        console.log("⬆️ Uploading to HubSpot...");
        console.log("🔑 Token starts with:", process.env.HUBSPOT_TOKEN?.substring(0, 15));

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
        console.log("📤 Upload Response:", JSON.stringify(uploadRes.data, null, 2));

        if (uploadRes.status === 200 || uploadRes.status === 201) {
          fileUrl =
            uploadRes.data?.url ||
            uploadRes.data?.cdn_url ||
            uploadRes.data?.full_path ||
            uploadRes.data?.defaultHostingUrl || "";

          if (!fileUrl && uploadRes.data?.id) {
            const fileDetail = await axios.get(
              `https://api.hubapi.com/files/v3/files/${uploadRes.data.id}`,
              {
                headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
                validateStatus: () => true,
              }
            );
            console.log("📄 File detail:", JSON.stringify(fileDetail.data, null, 2));
            fileUrl =
              fileDetail.data?.url ||
              fileDetail.data?.cdn_url ||
              fileDetail.data?.defaultHostingUrl ||
              fileDetail.data?.full_path || "";
          }
          console.log("✅ Final fileUrl:", fileUrl);
        } else {
          console.error("❌ Upload failed:", uploadRes.status, JSON.stringify(uploadRes.data));
        }
      } catch (fileError) {
        console.error("❌ File exception:", fileError.message);
      }
    }

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

    console.log("📋 file_url being sent:", fileUrl);

    const formRes = await axios.post(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        fields,
        context: { pageUri: req.headers.origin || "", pageName: "RFQ Form" },
      },
      {
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true,
      }
    );

    console.log("📝 Form Status:", formRes.status);
    console.log("📝 Form Response:", JSON.stringify(formRes.data, null, 2));

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
    console.error("💥 FATAL:", error.message);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error("💥 EXPRESS ERROR:", err.message);
  res.status(500).json({ success: false, error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
