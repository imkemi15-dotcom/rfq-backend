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
        console.log("📤 Upload Response:", JSON.stringify(uploadRes.data, null, 2));

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
                validateStatus: () => true,
              }
            );
            fileUrl =
              fileDetail.data?.url ||
              fileDetail.data?.defaultHostingUrl || "";
          }
          console.log("✅ Final fileUrl:", fileUrl);
        } else {
          console.error("❌ Upload failed:", uploadRes.status, JSON.stringify(uploadRes.data));
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

    console.log("📋 All fields being sent:", JSON.stringify(fields, null, 2));

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

    // ======================================
    // STEP 3: Update contact directly via API
    // ======================================
    // ✅ This is the key fix — update contact directly bypassing form limitations
    if (fileUrl && req.body.email) {
      try {
        console.log("🔄 Updating contact directly with file_url...");

        // First find the contact by email
        const searchRes = await axios.post(
          "https://api.hubapi.com/crm/v3/objects/contacts/search",
          {
            filterGroups: [{
              filters: [{
                propertyName: "email",
                operator: "EQ",
                value: req.body.email,
              }]
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

        console.log("🔍 Search Status:", searchRes.status);
        console.log("🔍 Search Response:", JSON.stringify(searchRes.data, null, 2));

        const contactId = searchRes.data?.results?.[0]?.id;

        if (contactId) {
          // Update the contact with file_url
          const updateRes = await axios.patch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
              properties: {
                file_url: fileUrl,
              },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              validateStatus: () => true,
            }
          );

          console.log("✏️ Update Status:", updateRes.status);
          console.log("✏️ Update Response:", JSON.stringify(updateRes.data, null, 2));

          if (updateRes.status === 200) {
            console.log("✅ Contact updated with file_url successfully!");
          } else {
            console.error("❌ Contact update failed:", updateRes.status, JSON.stringify(updateRes.data));
          }
        } else {
          console.error("❌ Contact not found for email:", req.body.email);
        }
      } catch (updateError) {
        console.error("❌ Contact update exception:", updateError.message);
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

app.use((err, req, res, next) => {
  console.error("💥 EXPRESS ERROR:", err.message);
  res.status(500).json({ success: false, error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
