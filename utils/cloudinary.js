const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Storage for classroom files (PDFs, images, etc.)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'intelliverse/classroom',
    // Removing strict allowed_formats to let resource_type auto handle everything (PDF, ZIP, PPT, etc.)
    resource_type: 'auto'
  }
});

const upload = multer({ storage: storage });

// Storage for lost and found images
const lostAndFoundStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'intelliverse/lost-and-found',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp']
  }
});

const lostAndFoundUpload = multer({ 
  storage: lostAndFoundStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = { cloudinary, upload, lostAndFoundUpload };
