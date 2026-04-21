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

// ✅ Test token and show all scopes
app.get("/test-token", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.hubapi.com/oauth/v1/access-tokens/" + process.env.HUBSPOT_TOKEN
    );
    res.json({
      success: true,
      message: "Token works ✅",
      scopes: response.data.scopes,
      hub_id: response.data.hub_id,
      token_type: response.data.token_type,
    });
  } catch (err) {
    res.json({
      success: false,
      message: "Token failed ❌",
      status: err.response?.status,
      error: err.response?.data,
    });
  }
});

app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  try {
    console.log("📩 Body:", req.body);
    console.log("📎 File:", req.file?.originalname || "none");

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

        console.log("⬆️ Uploading to HubSpot...");
        console.log("🔑 Token starts with:", process.env.HUBSPOT_TOKEN?.substring(0, 10));

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
            validateStatus: () => true, // never throw on any status
          }
        );

        console.log("📤 Upload Status:", uploadRes.status);
        console.log("📤 Upload Response:", JSON.stringify(uploadRes.data, null, 2));

        if (uploadRes.status === 200 || uploadRes.status === 201) {
          // ✅ Try every possible field HubSpot might return URL in
          fileUrl =
            uploadRes.data?.url ||
            uploadRes.data?.cdn_url ||
            uploadRes.data?.full_path ||
            uploadRes.data?.defaultHostingUrl ||
            "";

          // ✅ If still no URL but we have an ID, fetch it
          if (!fileUrl && uploadRes.data?.id) {
            console.log("🔍 No URL in response, fetching by ID:", uploadRes.data.id);
            try {
              const fileDetail = await axios.get(
                `https://api.hubapi.com/files/v3/files/${uploadRes.data.id}`,
                {
                  headers: {
                    Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
                  },
                  validateStatus: () => true,
                }
              );
              console.log("📄 File detail:", JSON.stringify(fileDetail.data, null, 2));
              fileUrl =
                fileDetail.data?.url ||
                fileDetail.data?.cdn_url ||
                fileDetail.data?.defaultHostingUrl ||
                fileDetail.data?.full_path ||
                "";
            } catch (detailErr) {
              console.error("❌ Could not fetch file detail:", detailErr.message);
            }
          }

          console.log("✅ Final fileUrl:", fileUrl);

        } else {
          console.error("❌ Upload failed. Status:", uploadRes.status);
          console.error("❌ Response:", JSON.stringify(uploadRes.data));
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
    console.error("💥 FATAL ERROR:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
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
