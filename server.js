require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const FormData = require("form-data");

const app = express();

// ✅ Memory storage (Render safe)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("RFQ Backend is running ✅");
});

app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    console.log("Incoming:", req.body);
    console.log("File:", req.file);

    let fileUrl = "";

    // ======================================
    // ✅ STEP 1: Upload file to HubSpot
    // ======================================
    if (req.file) {
      const formData = new FormData();

      formData.append("file", req.file.buffer, req.file.originalname);
      formData.append(
        "options",
        JSON.stringify({
          access: "PUBLIC_INDEXABLE"
        })
      );
      formData.append("folderPath", "/rfq-uploads");

      const uploadRes = await fetch("https://api.hubapi.com/files/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
          ...formData.getHeaders()
        },
        body: formData
      });

      const uploadData = await uploadRes.json();

      console.log("File Upload Response:", uploadData);

      if (uploadRes.ok && uploadData.url) {
        fileUrl = uploadData.url;
      }
    }

    // ======================================
    // ✅ STEP 2: Submit to HubSpot Form
    // ======================================
    const portalId = "46017352";
    const formGuid = "fea88d11-c240-47a8-a280-3dc28d248ab6";

    const formPayload = {
  fields: [
    { name: "email", value: req.body.email }, // MUST BE FIRST
    { name: "firstname", value: req.body.name },
    { name: "phone", value: req.body.phone || "" },
    { name: "company", value: req.body.company || "" },
    { name: "project_description", value: req.body.project_description || "" },
    { name: "material_type", value: req.body.material_type || "" },
    { name: "quantity", value: req.body.quantity || "" },
    { name: "timeline", value: req.body.timeline || "" },
    { name: "file_url", value: fileUrl }
  ],
  context: {
    hutk: req.cookies?.hubspotutk || "", // ✅ VERY IMPORTANT
    pageUri: req.headers.origin || "",
    pageName: "RFQ Form"
  }
};

    const formRes = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formPayload)
      }
    );

    const formText = await formRes.text();

    console.log("Form Status:", formRes.status);
    console.log("Form Response:", formText);

    if (!formRes.ok) {
      return res.status(400).json({
        success: false,
        message: "Form submission failed",
        error: formText
      });
    }

    // ======================================
    // ✅ FINAL SUCCESS
    // ======================================
    return res.json({
      success: true,
      message: "RFQ submitted successfully 🎉",
      file_url: fileUrl
    });

  } catch (error) {
    console.error("ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
