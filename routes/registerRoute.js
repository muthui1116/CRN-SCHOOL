import passport from "../passportConfig.js";
import db from "../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
import path from "path";
import fs from "fs";
import upload from "../multer.js";
const saltRounds = 12;

export default function registerRoutes(app) {
  // Initiate Google OAuth flow
  app.get(
    "/auth/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
    }),
  );

  // Google OAuth callback
  app.get(
    "/auth/google/appa",
    passport.authenticate("google", {
      successRedirect: "/",
      failureRedirect: "/login",
    }),
  );

  // Local login
  app.post(
    "/login",
    passport.authenticate("local", {
      successRedirect: "/",
      failureRedirect: "/login",
    }),
  );

  // AUTHENTICATION MIDDLEWARE - MAKE USER INFO AVAILABLE IN ALL VIEWS
  app.use((req, res, next) => {
    res.locals.user = req.user || null;
    next();
  });

  function getRoleLanding(role) {
    if (role === 1) return "/admin";
    if (role === 2) return "/exams";
    if (role === 3) return "/learner";
    return "/profile";
  }

  app.get("/", (req, res) => {
    if (req.isAuthenticated()) {
      return res.redirect(getRoleLanding(req.user.role));
    }
    return res.redirect("/home");
  });

  app.get("/home", (req, res) => {
    res.render("home.ejs");
  });

  app.get("/teacher", isAuthenticated, isTeacher, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, email, phone, password, role, date_created, updated_at, profile_image
         FROM users WHERE id = $1`,
        [req.user.id],
      );
      res.render("profile.ejs", {
        user: req.user,
        userProfile: result.rows[0],
      });
    } catch (err) {
      console.error("Teacher landing error:", err.message);
      res.status(500).render("error.ejs", {
        message: "Error loading teacher dashboard.",
        user: req.user,
      });
    }
  });

  // Middleware to check if user is manager (role 1) =========================
  function isManager(req, res, next) {
    if (req.isAuthenticated() && req.user && req.user.role === 1) {
      return next();
    }
    return res.status(403).send("Access denied. Manager privileges required.");
  }

  // Middleware to check if user is teacher (role 2) =========================
  function isTeacher(req, res, next) {
    if (req.isAuthenticated() && req.user && req.user.role === 2) {
      return next();
    }
    return res.status(403).send("Access denied. Teacher privileges required.");
  }

  // ─── Auth Guard (open after login) ─────────────────────────────────
  function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect("/login");
  }

  // ─── Routes ───────────────────────────────────────────────────────────────────
  app.get("/register", (req, res) => {
    res.render("register.ejs");
  });

  app.post(
    "/register",
    upload.single("profile_image"),
    async (req, res) => {
      const { name, email, phone, password } = req.body;

      if (!email || !password) {
        return res.status(400).send("Email and password are required");
      }

      try {
        const existingUser = await db.query(
          "SELECT id FROM users WHERE email = $1",
          [email],
        );
        if (existingUser.rows.length > 0) {
          return res.status(400).send("A user with that email already exists");
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        let profileImageUrl = null;
        if (req.file) {
          profileImageUrl =
            "/" + req.file.path.replace(/\\/g, "/").replace("public/", "");
        }

        await db.query(
          `INSERT INTO users (
            name, email, phone, password, role, profile_image
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            name || null,
            email,
            phone || null,
            hashedPassword,
            3,
            profileImageUrl,
          ],
        );

        res.redirect("/login");
      } catch (err) {
        console.error("Registration error:", err.message);
        res.status(500).send("Server error: " + err.message);
      }
    },
  );

  app.get("/login", (req, res) => {
    res.render("login.ejs");
  });

  app.get("/forgot-password", (req, res) => {
    res.render("forgot-password.ejs");
  });

  app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.render("forgot-password.ejs", { error: "Email is required." });
    }

    try {
      const { rows } = await db.query(
        "SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [email],
      );

      const token = crypto.randomBytes(24).toString("hex");
      const expires = new Date(Date.now() + 1000 * 60 * 60);

      if (rows.length > 0) {
        await db.query(
          `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
          [token, expires, rows[0].id],
        );

        const resetLink = `${req.protocol}://${req.get("host")}/reset-password?token=${token}`;

        const transporter = nodemailer.createTransport({
          host: process.env.EMAIL_HOST,
          port: Number(process.env.EMAIL_PORT) || 587,
          secure: process.env.EMAIL_SECURE === "true",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        const mailOptions = {
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          to: rows[0].email,
          subject: "Password Reset Request",
          text: `You requested a password reset. Use the link below to reset your password:\n\n${resetLink}`,
          html: `<p>You requested a password reset.</p><p>Click the link below to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
        };

        await transporter.sendMail(mailOptions);
      }

      return res.render("forgot-password.ejs", {
        success: "If that email is registered, a password reset link has been sent.",
      });
    } catch (err) {
      console.error("Forgot password error:", err.message);
      res.status(500).render("forgot-password.ejs", {
        error: "Unable to process the password reset request.",
      });
    }
  });

  app.get("/reset-password", async (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.render("reset-password.ejs", {
        error: "Reset token is required.",
      });
    }

    try {
      const { rows } = await db.query(
        `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > now() LIMIT 1`,
        [token],
      );

      if (rows.length === 0) {
        return res.render("reset-password.ejs", {
          error: "Invalid or expired reset link.",
        });
      }

      res.render("reset-password.ejs", {
        tokenValid: true,
        token,
      });
    } catch (err) {
      console.error("Reset password page error:", err.message);
      res.status(500).render("reset-password.ejs", {
        error: "Unable to load reset page.",
      });
    }
  });

  app.post("/reset-password", async (req, res) => {
    const { token, new_password, confirm_password } = req.body;

    if (!token) {
      return res.render("reset-password.ejs", {
        error: "Reset token is required.",
      });
    }

    if (!new_password || !confirm_password) {
      return res.render("reset-password.ejs", {
        error: "Please provide a new password and confirm it.",
        tokenValid: true,
        token,
      });
    }

    if (new_password !== confirm_password) {
      return res.render("reset-password.ejs", {
        error: "Passwords do not match.",
        tokenValid: true,
        token,
      });
    }

    try {
      const { rows } = await db.query(
        `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > now() LIMIT 1`,
        [token],
      );

      if (rows.length === 0) {
        return res.render("reset-password.ejs", {
          error: "Invalid or expired reset link.",
        });
      }

      const hashedPassword = await bcrypt.hash(new_password, saltRounds);
      await db.query(
        `UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2`,
        [hashedPassword, rows[0].id],
      );

      res.render("reset-password.ejs", {
        success: "Your password has been reset successfully.",
      });
    } catch (err) {
      console.error("Reset password submit error:", err.message);
      res.status(500).render("reset-password.ejs", {
        error: "Unable to reset your password.",
      });
    }
  });

  app.get("/add-user", (req, res) => {
    res.render("addUser.ejs");
  });

  app.post(
    "/user/add",
    isAuthenticated,
    isManager,
    upload.single("profile_image"),
    async (req, res) => {
      const {
        name,
        email,
        phone,
        tsc_no,
        id_no,
        role,
        password,
        responsibility,
        department,
        subject_combination,
        grade,
        assessment_number,
        street,
        apartment,
        city,
        zip,
        country,
        is_admin,
        email_verified,
      } = req.body;

      // Default to role 3 (Learner) if no role is provided
      const assignedRole = role ? parseInt(role) : 3;

      try {
        // Password is required for new users
        if (!password || password.trim() === "") {
          return res.status(400).send("Password is required");
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Handle profile image
        let profileImageUrl = null;
        if (req.file) {
          profileImageUrl =
            "/" + req.file.path.replace(/\\/g, "/").replace("public/", "");
        }

        await db.query(
          `INSERT INTO users (
        name, email, phone, tsc_no, id_no,
        role, password, profile_image,
        responsibility, department,
        subject_combination, grade, assessment_number,
        street, apartment, city, zip, country,
        is_admin, email_verified
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10,
        $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20
      )`,
          [
            name,
            email,
            phone || null,
            tsc_no || null,
            id_no || null,
            assignedRole,
            hashedPassword,
            profileImageUrl,
            responsibility || null,
            department || null,
            subject_combination || null,
            grade || null,
            assessment_number || null,
            street || null,
            apartment || null,
            city || null,
            zip || null,
            country || null,
            is_admin === "true",
            email_verified === "true",
          ],
        );

        res.redirect("/");
      } catch (err) {
        console.error(err);
        res.status(500).send("Server error: " + err.message);
      }
    },
  );


  app.get("/edit-user", (req, res) => {
    res.render("editUser.ejs");
  });

  // GET /users/:id/edit
  app.get("/edit-user/:id/edit", async (req, res) => {
    try {
      const user = await db.query("SELECT * FROM users WHERE id = $1", [
        req.params.id,
      ]);

      if (!user.rows[0]) {
        return res.status(404).send("User not found");
      }

      res.render("editUser.ejs", { user: user.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  });

  app.post(
    "/edit-user/:id/edit",
    isAuthenticated,
    isManager,
    upload.single("profile_image"),
    async (req, res) => {
      const {
        name,
        email,
        phone,
        tsc_no,
        id_no,
        role,
        password,
        responsibility,
        department,
        subject_combination,
        grade,
        assessment_number,
        street,
        apartment,
        city,
        zip,
        country,
        is_admin,
        email_verified,
        email_verify_token,
        reset_token,
        reset_token_expires,
        remove_profile_image,
      } = req.body;

      // Default to role 3 (Learner) if no role is provided
      const assignedRole = role ? parseInt(role) : 3;

      try {
        const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [
          req.params.id,
        ]);
        if (!rows[0]) return res.status(404).send("User not found");

        const currentUser = rows[0];

        // Handle password — only update if a new one was provided
        let hashedPassword = currentUser.password;
        if (password && password.trim() !== "") {
          hashedPassword = await bcrypt.hash(password, saltRounds);
        }

        // Handle profile image — three possible states:
        let profileImageUrl;

        if (req.file) {
          // 1. New file uploaded → use it, delete old one from disk
          profileImageUrl =
            "/" + req.file.path.replace(/\\/g, "/").replace("public/", "");
          if (currentUser.profile_image) {
            const oldPath = path.join("public", currentUser.profile_image);
            fs.unlink(oldPath, (err) => {
              if (err) console.warn("Could not delete old image:", err.message);
            });
          }
        } else if (remove_profile_image === "true") {
          // 2. User clicked Remove → clear DB value, delete file from disk
          profileImageUrl = null;
          if (currentUser.profile_image) {
            const oldPath = path.join("public", currentUser.profile_image);
            fs.unlink(oldPath, (err) => {
              if (err) console.warn("Could not delete image:", err.message);
            });
          }
        } else {
          // 3. No change → keep whatever is in the DB
          profileImageUrl = currentUser.profile_image;
        }

        await db.query(
          `UPDATE users SET
        name = $1, email = $2, phone = $3, tsc_no = $4, id_no = $5,
        role = $6, password = $7, profile_image = $8,
        responsibility = $9, department = $10,
        subject_combination = $11, grade = $12, assessment_number = $13,
        street = $14, apartment = $15, city = $16, zip = $17, country = $18,
        is_admin = $19, email_verified = $20,
        email_verify_token = $21, reset_token = $22,
        reset_token_expires = $23, updated_at = now()
       WHERE id = $24`,
          [
            name,
            email,
            phone || null,
            tsc_no || null,
            id_no || null,
            assignedRole,
            hashedPassword,
            profileImageUrl,
            responsibility || null,
            department || null,
            subject_combination || null,
            grade || null,
            assessment_number || null,
            street || null,
            apartment || null,
            city || null,
            zip || null,
            country || null,
            is_admin === "true",
            email_verified === "true",
            email_verify_token || null,
            reset_token || null,
            reset_token_expires || null,
            req.params.id,
          ],
        );

        res.redirect("/");
      } catch (err) {
        console.error(err);
        res.status(500).send("Server error: " + err.message);
      }
    },
  );

  app.post(
    "/users/delete/:id",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [
          req.params.id,
        ]);

        if (!rows[0]) {
          return res.status(404).send("User not found");
        }

        // Prevent deleting yourself
        if (req.user.id === parseInt(req.params.id)) {
          return res.status(400).send("You cannot delete your own account.");
        }

        await db.query("DELETE FROM users WHERE id = $1", [req.params.id]);

        res.redirect("/");
      } catch (err) {
        console.error(err);
        res.status(500).send("Server error: " + err.message);
      }
    },
  );
}
