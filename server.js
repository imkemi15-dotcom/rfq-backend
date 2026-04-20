require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

// ✅ Test route
app.get("/", (req, res) => {
  res.send("RFQ Backend is running ✅");
});

// ✅ RFQ API
app.post("/submit-rfq", upload.single("file"), async (req, res) => {
  try {
    console.log("Incoming:", req.body);
    console.log("File:", req.file);

    const data = {
      properties: {
        email: req.body.email,
        firstname: req.body.name,
        company: req.body.company || "",
        phone: req.body.phone || "",
        project_description: req.body.project_description || "",
        material_type: req.body.material_type || "",
        quantity: req.body.quantity || "",
        timeline: req.body.timeline || ""
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
        body: JSON.stringify(data)
      }
    );

    const result = await response.json();

    console.log("HubSpot:", result);

    if (!response.ok) {
      return res.status(response.status).json(result);
    }

    res.json({
      success: true,
      file: req.file ? req.file.filename : null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000 🚀"));