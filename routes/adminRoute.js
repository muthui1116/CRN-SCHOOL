import db from "../db.js";
import bcrypt from "bcrypt";
import path from "path";
import fs from "fs";
import upload from "../multer.js";
import { validateSubjectScores } from "../utils/gradeUtils.js";
import { fetchTeachersList } from "../utils/teacherUtils.js";

const saltRounds = 12;

// ─── Middleware ───────────────────────────────────────────────────────────────
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

function isManager(req, res, next) {
  if (req.isAuthenticated() && req.user && req.user.role === 1) {
    return next();
  }
  return res.status(403).send("Access denied. Manager privileges required.");
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export default function registerAdminRoutes(app) {
  app.get("/users/add", isAuthenticated, isManager, (req, res) => {
    res.render("addUser.ejs", { errors: [] });
  });

  app.get("/admin", isAuthenticated, isManager, async (req, res) => {
    try {
      const result = await db.query("SELECT * FROM users ORDER BY id ASC");
      res.render("adminDashboard.ejs", { page: "users", users: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  });

  app.get("/grades", isAuthenticated, isManager, async (req, res) => {
    try {
      const gradeResult = await db.query("SELECT * FROM grade ORDER BY id ASC");
      const teacherResult = await fetchTeachersList();
      res.render("adminDashboard.ejs", {
        page: "grades",
        grades: gradeResult.rows,
        teachers: teacherResult,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  });

  app.get("/grades/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const teacherResult = await fetchTeachersList();
      res.render("addGrade.ejs", { teachers: teacherResult });
    } catch (err) {
      console.error("Get add grade page error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.post("/grades/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const { name, enrolment, class_teacher } = req.body;
      await db.query(
        "INSERT INTO grade (name, enrolment, class_teacher) VALUES ($1, $2, $3)",
        [
          name || null,
          enrolment ? parseInt(enrolment, 10) : null,
          class_teacher || null,
        ],
      );
      res.redirect("/grades");
    } catch (err) {
      console.error("Add grade error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.get("/grades/:id/edit", isAuthenticated, isManager, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM grade WHERE id = $1", [
        req.params.id,
      ]);
      if (!rows[0]) return res.status(404).send("Grade not found");
      const teacherResult = await fetchTeachersList();
      res.render("editGrade.ejs", { grade: rows[0], teachers: teacherResult });
    } catch (err) {
      console.error("Get grade error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.post("/grades/:id/edit", isAuthenticated, isManager, async (req, res) => {
    try {
      const { name, enrolment, class_teacher } = req.body;
      await db.query(
        "UPDATE grade SET name = $1, enrolment = $2, class_teacher = $3 WHERE id = $4",
        [
          name || null,
          enrolment ? parseInt(enrolment, 10) : null,
          class_teacher || null,
          req.params.id,
        ],
      );
      res.redirect("/grades");
    } catch (err) {
      console.error("Update grade error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.post(
    "/grades/delete/:id",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        await db.query("DELETE FROM grade WHERE id = $1", [req.params.id]);
        res.redirect("/grades");
      } catch (err) {
        console.error("Delete grade error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.get("/teachers", isAuthenticated, isManager, async (req, res) => {
    try {
      let rows;
      try {
        const result = await db.query("SELECT * FROM teacher ORDER BY id ASC");
        rows = result.rows;
      } catch (err) {
        if (err.code === "42P01") {
          const fallback = await db.query(
            "SELECT * FROM users WHERE role = 2 ORDER BY id ASC",
          );
          rows = fallback.rows;
        } else throw err;
      }
      res.render("adminDashboard.ejs", { page: "teachers", teachers: rows });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  });

  app.get("/teachers/add", isAuthenticated, isManager, (req, res) => {
    res.render("addTeacher.ejs");
  });

  app.post("/teachers/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const {
        name,
        tsc_no,
        grade,
        subject_combination,
        department,
        responsibility,
      } = req.body;
      await db.query(
        `INSERT INTO teacher (name, tsc_no, grade, subject_combination, department, responsibility) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          name || null,
          tsc_no || null,
          grade || null,
          subject_combination || null,
          department || null,
          responsibility || null,
        ],
      );
      res.redirect("/teachers");
    } catch (err) {
      console.error("Add teacher error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.get(
    "/teachers/:id/edit",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const { rows } = await db.query("SELECT * FROM teacher WHERE id = $1", [
          req.params.id,
        ]);
        if (!rows[0]) return res.status(404).send("Teacher not found");
        res.render("editTeacher.ejs", { teacher: rows[0] });
      } catch (err) {
        console.error("Get teacher error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.post(
    "/teachers/:id/edit",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const {
          name,
          tsc_no,
          grade,
          subject_combination,
          department,
          responsibility,
        } = req.body;
        await db.query(
          `UPDATE teacher SET name = $1, tsc_no = $2, grade = $3, subject_combination = $4, department = $5, responsibility = $6 WHERE id = $7`,
          [
            name || null,
            tsc_no || null,
            grade || null,
            subject_combination || null,
            department || null,
            responsibility || null,
            req.params.id,
          ],
        );
        res.redirect("/teachers");
      } catch (err) {
        console.error("Update teacher error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.post(
    "/teachers/delete/:id",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        await db.query("DELETE FROM teacher WHERE id = $1", [req.params.id]);
        res.redirect("/teachers");
      } catch (err) {
        console.error("Delete teacher error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.get("/departments", isAuthenticated, isManager, async (req, res) => {
    try {
      const result = await db.query(
        "SELECT * FROM departments ORDER BY id ASC",
      );
      res.render("adminDashboard.ejs", {
        page: "departments",
        departments: result.rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  }); ;                                              

  app.get("/departments/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const result = await db.query(
        "SELECT id, name FROM teacher ORDER BY name ASC",
      );
      res.render("addDepartment.ejs", { teachers: result.rows });
    } catch (err) {
      console.error("Get teachers error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.post("/departments/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const { name, hod } = req.body;
      await db.query(`INSERT INTO departments (name, hod) VALUES ($1, $2)`, [
        name || null,
        hod || null,
      ]);
      res.redirect("/departments");
    } catch (err) {
      console.error("Add department error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.get(
    "/departments/:id/edit",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const { rows: deptRows } = await db.query(
          "SELECT * FROM departments WHERE id = $1",
          [req.params.id],
        );
        if (!deptRows[0]) return res.status(404).send("Department not found");
        const { rows: teacherRows } = await db.query(
          "SELECT id, name FROM teacher ORDER BY name ASC",
        );
        res.render("editDepartment.ejs", {
          department: deptRows[0],
          teachers: teacherRows,
        });
      } catch (err) {
        console.error("Get department error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.post(
    "/departments/:id/edit",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const { name, hod } = req.body;
        await db.query(
          `UPDATE departments SET name = $1, hod = $2 WHERE id = $3`,
          [name || null, hod || null, req.params.id],
        );
        res.redirect("/departments");
      } catch (err) {
        console.error("Update department error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.post(
    "/departments/delete/:id",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        await db.query("DELETE FROM departments WHERE id = $1", [
          req.params.id,
        ]);
        res.redirect("/departments");
      } catch (err) {
        console.error("Delete department error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.get("/learners", isAuthenticated, isManager, async (req, res) => {
    try {
      const result = await db.query("SELECT * FROM learners ORDER BY id ASC");
      const gradeResult = await db.query("SELECT * FROM grade ORDER BY id ASC");
      const teacherResult = await fetchTeachersList();
      res.render("adminDashboard.ejs", {
        page: "learners",
        learners: result.rows,
        grades: gradeResult.rows,
        teachers: teacherResult,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  });

  app.get("/learners/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const gradeResult = await db.query("SELECT * FROM grade ORDER BY id ASC");
      const teacherResult = await fetchTeachersList();
      res.render("addLearner.ejs", {
        grades: gradeResult.rows,
        teachers: teacherResult,
      });
    } catch (err) {
      console.error("Get add learner page error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.post("/learners/add", isAuthenticated, isManager, async (req, res) => {
    try {
      const { name, assessment_number, birth_certificate, grade, class_teacher, responsibility } =
        req.body;
      await db.query(
        `INSERT INTO learners (name, assessment_number, birth_certificate, grade, class_teacher, responsibility) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          name || null,
          assessment_number || null,
          birth_certificate || null,
          grade || null,
          class_teacher || null,
          responsibility || null,
        ],
      );
      res.redirect("/learners");
    } catch (err) {
      console.error("Add learner error:", err.message);
      res.status(500).send("Server error");
    }
  });

  app.get(
    "/learners/:id/edit",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM learners WHERE id = $1",
          [req.params.id],
        );
        if (!rows[0]) return res.status(404).send("Learner not found");
        const gradeResult = await db.query(
          "SELECT * FROM grade ORDER BY id ASC",
        );
        const teacherResult = await fetchTeachersList();
        res.render("editLearner.ejs", {
          learner: rows[0],
          grades: gradeResult.rows,
          teachers: teacherResult,
        });
      } catch (err) {
        console.error("Get learner error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.post(
    "/learners/:id/edit",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        const scoreValidation = validateSubjectScores(req.body);
        if (!scoreValidation.valid)
          return res.status(400).send(scoreValidation.message);

        const fields = [];
        const values = [];
        let idx = 1;
        for (const [k, v] of Object.entries(req.body)) {
          if (
            [
              "name",
              "assessment_number",
              "birth_certificate",
              "grade",
              "class_teacher",
              "responsibility",
              "english",
              "english_pl",
              "english_points",
              "cre",
              "cre_pl",
              "cre_points",
              "pre_technical",
              "pre_technical_pl",
              "pre_technical_points",
              "integrated_science",
              "integrated_science_pl",
              "integrated_science_points",
              "agriculture",
              "agriculture_pl",
              "agriculture_points",
              "biology",
              "biology_pl",
              "biology_points",
              "mathematics",
              "mathematics_pl",
              "mathematics_points",
              "kiswahili",
              "kiswahili_pl",
              "kiswahili_points",
              "creative_arts",
              "creative_arts_pl",
              "creative_arts_points",
              "evrg",
              "evrg_pl",
              "evrg_points",
            ].includes(k)
          ) {
            fields.push(`${k} = $${idx}`);
            values.push(v === "" ? null : v);
            idx++;
          }
        }

        if (fields.length === 0) return res.redirect("/learners");
        values.push(req.params.id);
        await db.query(
          `UPDATE learners SET ${fields.join(", ")} WHERE id = $${idx}`,
          values,
        );
        res.redirect("/learners");
      } catch (err) {
        console.error("Update learner error:", err.message);
        res.status(500).send("Server error");
      }
    },
  );

  app.post(
    "/learners/delete/:id",
    isAuthenticated,
    isManager,
    async (req, res) => {
      try {
        await db.query("DELETE FROM learners WHERE id = $1", [req.params.id]);
        res.redirect("/learners");
      } catch (err) {
        console.error("Delete learner error:", err.message);
        res.status(500).send("Server error");
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
        return res.status(400).json({
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
      return res.status(400).json({
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

  // GET /logout
  app.get("/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).send("Error logging out");
      }
      req.session.destroy((err) => {
        if (err) console.error("Session destroy error:", err);
        res.redirect("/login");
      });
    });
  });

  // POST /profile/update - Update user profile
  app.post(
    "/profile/update",
    isAuthenticated,
    upload.single("profile_image"),
    async (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Must be logged in" });
      }

      const userId = req.user.id;
      const { email, phone, current_password, new_password, remove_image } =
        req.body;

      try {
        console.log("Updating profile for user:", userId);

        const userResult = await db.query("SELECT * FROM users WHERE id = $1", [
          userId,
        ]);

        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        const currentUser = userResult.rows[0];

        if (email && email !== currentUser.email) {
          const emailCheck = await db.query(
            "SELECT id FROM users WHERE email = $1 AND id != $2",
            [email, userId],
          );
          if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: "Email already in use" });
          }
        }

        if (
          phone &&
          !/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/.test(phone)
        ) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }

        let hashedPassword = currentUser.password;
        if (new_password && new_password.trim() !== "") {
          if (!current_password) {
            return res
              .status(400)
              .json({ error: "Current password required to change password" });
          }

          const isPasswordValid = await new Promise((resolve) => {
            bcrypt.compare(
              current_password,
              currentUser.password,
              (err, result) => {
                if (err) resolve(false);
                else resolve(result);
              },
            );
          });

          if (!isPasswordValid) {
            return res
              .status(400)
              .json({ error: "Current password is incorrect" });
          }

          hashedPassword = await new Promise((resolve, reject) => {
            bcrypt.hash(new_password, saltRounds, (err, hash) => {
              if (err) reject(err);
              else resolve(hash);
            });
          });
        }

        // Handle profile image — three states
        let profileImageUrl = currentUser.profile_image;

        if (req.file) {
          // 1. New image uploaded → save it, delete old one from disk
          profileImageUrl =
            "/" + req.file.path.replace(/\\/g, "/").replace("public/", "");
          console.log("New profile image saved:", profileImageUrl);

          if (currentUser.profile_image) {
            const oldPath = path.join("public", currentUser.profile_image);
            fs.unlink(oldPath, (err) => {
              if (err) console.warn("Could not delete old image:", err.message);
            });
          }
        } else if (remove_image === "true") {
          // 2. Remove requested → null out DB value, delete file from disk
          profileImageUrl = null;
          console.log("Removing profile image");

          if (currentUser.profile_image) {
            const oldPath = path.join("public", currentUser.profile_image);
            fs.unlink(oldPath, (err) => {
              if (err) console.warn("Could not delete image:", err.message);
            });
          }
        }
        // 3. No change → profileImageUrl stays as currentUser.profile_image

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

        if (updateResult.rows.length === 0) {
          return res.status(500).json({ error: "Failed to update profile" });
        }

        const updatedUser = updateResult.rows[0];

        req.user.email = updatedUser.email;
        req.user.phone = updatedUser.phone;
        req.user.profile_image = updatedUser.profile_image;

        console.log("User profile updated successfully");

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
}
