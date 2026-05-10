const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists (with recursive to avoid nested folder errors)
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize and make filename unique
    const safeName = file.originalname
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_.-]/g, ""); // keep only safe chars
    const uniqueName = `${Date.now()}-${safeName}`;
    cb(null, uniqueName);
  },
});

// File filter for images (Lost & Found)
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(
      new Error("❌ Invalid file type. Only JPEG, JPG, and PNG images are allowed.")
    );
  }
};

// File filter for HelpDesk attachments (documents and images)
const attachmentFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|zip|rar|mp4|mov|webm|mkv/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(
      new Error("❌ Invalid file type. Only image and document files are allowed.")
    );
  }
};

// Multer instances
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: imageFileFilter,
});

const uploadAttachment = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB for attachments (videos allowed)
  fileFilter: attachmentFileFilter,
});

module.exports = { upload, uploadAttachment };
