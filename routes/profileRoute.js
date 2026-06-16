import db from "../db.js";
import bcrypt from "bcrypt";
import path from "path";
import fs from "fs";
import upload from "../multer.js";

const saltRounds = 12;

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

export default function registerProfileRoutes(app) {
  // GET /profile
  app.get("/profile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.id;

      const userResult = await db.query(
        `SELECT id, email, phone, password, role, date_created, updated_at, profile_image
         FROM users WHERE id = $1`,
        [userId],
      );

      if (userResult.rows.length === 0) {
        return res.status(404).render("error.ejs", {
          message: "User profile not found",
          user: req.user,
        });
      }

      res.render("profile.ejs", {
        user: req.user,
        userProfile: userResult.rows[0],
      });
    } catch (err) {
      console.error("Error fetching profile:", err.message);
      res.status(500).render("error.ejs", {
        message: "Error loading profile: " + err.message,
        user: req.user,
      });
    }
  });

  // POST /profile/update
  app.post(
    "/profile/update",
    isAuthenticated,
    upload.single("profile_image"),
    async (req, res) => {
      const userId = req.user.id;
      const { email, phone, current_password, new_password, remove_image } =
        req.body;

      try {
        const userResult = await db.query("SELECT * FROM users WHERE id = $1", [
          userId,
        ]);
        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        const currentUser = userResult.rows[0];

        // Validate email if changed
        if (email && email !== currentUser.email) {
          const emailCheck = await db.query(
            "SELECT id FROM users WHERE email = $1 AND id != $2",
            [email, userId],
          );
          if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: "Email already in use" });
          }
        }

        // Validate phone format
        if (
          phone &&
          !/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/.test(phone)
        ) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }

        // Handle password change
        let hashedPassword = currentUser.password;
        if (new_password && new_password.trim() !== "") {
          if (!current_password) {
            return res
              .status(400)
              .json({ error: "Current password required to change password" });
          }
          const isPasswordValid = await bcrypt.compare(
            current_password,
            currentUser.password,
          );
          if (!isPasswordValid) {
            return res
              .status(400)
              .json({ error: "Current password is incorrect" });
          }
          hashedPassword = await bcrypt.hash(new_password, saltRounds);
        }

        // Handle profile image
        let profileImageUrl = currentUser.profile_image;

        if (req.file) {
          profileImageUrl =
            "/" + req.file.path.replace(/\\/g, "/").replace("public/", "");
          if (currentUser.profile_image) {
            const oldPath = path.join("public", currentUser.profile_image);
            fs.unlink(oldPath, (err) => {
              if (err) console.warn("Could not delete old image:", err.message);
            });
          }
        } else if (remove_image === "true") {
          profileImageUrl = null;
          if (currentUser.profile_image) {
            const oldPath = path.join("public", currentUser.profile_image);
            fs.unlink(oldPath, (err) => {
              if (err) console.warn("Could not delete image:", err.message);
            });
          }
        }

        const updateResult = await db.query(
          `UPDATE users 
         SET email = COALESCE($1, email),
             phone = COALESCE($2, phone),
             password = $3,
             profile_image = $4,
             updated_at = now()
         WHERE id = $5
         RETURNING id, email, phone, profile_image, updated_at`,
          [
            email || null,
            phone || null,
            hashedPassword,
            profileImageUrl,
            userId,
          ],
        );

        const updatedUser = updateResult.rows[0];

        // Update session
        req.user.email = updatedUser.email;
        req.user.phone = updatedUser.phone;
        req.user.profile_image = updatedUser.profile_image;

        res.json({
          success: true,
          message: "Profile updated successfully",
          user: {
            email: updatedUser.email,
            phone: updatedUser.phone,
            profile_image: updatedUser.profile_image,
            updated_at: updatedUser.updated_at,
          },
        });
      } catch (err) {
        console.error("Profile update error:", err);
        res.status(500).json({ error: "Server error: " + err.message });
      }
    },
  );

  // POST /profile/change-password
  app.post("/profile/change-password", isAuthenticated, async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const userId = req.user.id;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (new_password.length < 6) {
      return res
        .status(400)
        .json({ error: "New password must be at least 6 characters" });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    try {
      const result = await db.query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = result.rows[0];
      const isValid = await bcrypt.compare(current_password, user.password);
      if (!isValid) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
      if (current_password === new_password) {
        return res
          .status(400)
          .json({
            error: "New password must be different from current password",
          });
      }

      const hashed = await bcrypt.hash(new_password, saltRounds);
      await db.query(
        "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
        [hashed, userId],
      );

      res.json({ success: true, message: "Password changed successfully" });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ error: "Server error: " + err.message });
    }
  });

  // POST /profile/delete-account
  app.post("/profile/delete-account", isAuthenticated, async (req, res) => {
    const { confirm_email, confirmation_text, confirm_password } = req.body;
    const userId = req.user.id;

    if (!confirm_email || !confirmation_text || !confirm_password) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (confirmation_text !== "DELETE MY ACCOUNT") {
      return res
        .status(400)
        .json({
          error:
            "Confirmation text does not match. Type exactly: DELETE MY ACCOUNT",
        });
    }

    try {
      const result = await db.query("SELECT * FROM users WHERE id = $1", [
        userId,
      ]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = result.rows[0];

      if (confirm_email.toLowerCase() !== user.email.toLowerCase()) {
        return res
          .status(400)
          .json({ error: "Email does not match your account email" });
      }

      const isValid = await bcrypt.compare(confirm_password, user.password);
      if (!isValid) {
        return res.status(400).json({ error: "Incorrect password" });
      }

      if (user.profile_image) {
        const imgPath = path.join("public", user.profile_image);
        fs.unlink(imgPath, (err) => {
          if (err) console.warn("Could not delete profile image:", err.message);
        });
      }

      await db.query("DELETE FROM users WHERE id = $1", [userId]);

      req.logout((err) => {
        if (err) console.error("Logout error after delete:", err);
      });

      res.json({ success: true, message: "Account deleted successfully" });
    } catch (err) {
      console.error("Delete account error:", err);
      res.status(500).json({ error: "Server error: " + err.message });
    }
  });
}
