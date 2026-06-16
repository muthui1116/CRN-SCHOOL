import db from "../db.js";

export async function fetchTeachersList() {
  try {
    const result = await db.query(
      "SELECT id, name FROM teacher ORDER BY name ASC",
    );
    return result.rows;
  } catch (err) {
    if (err.code === "42P01") {
      const fallback = await db.query(
        "SELECT id, name FROM users WHERE role = 2 ORDER BY name ASC",
      );
      return fallback.rows;
    }
    throw err;
  }
}
