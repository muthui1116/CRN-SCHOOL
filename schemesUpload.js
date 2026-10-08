import fs from "fs";
import multer from "multer";
import path from "path";

const uploadDir = path.resolve("uploads/schemes");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = path.basename(file.originalname, path.extname(file.originalname)).replace(/[^a-zA-Z0-9-_]/g, "-");
    cb(null, `${Date.now()}-${name}${ext}`);
  },
});

const allowedTypes = new Map([
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword", "application/vnd.ms-word"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
]);

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = allowedTypes.get(path.extname(file.originalname).toLowerCase());
  if (allowedMimeTypes?.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(new Error("Only PDF, DOC, and DOCX files are allowed"));
};

const schemesUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

export default schemesUpload;
