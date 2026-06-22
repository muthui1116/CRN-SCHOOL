import dotenv from "dotenv";
dotenv.config();
import passport from "passport";
import Strategy from "passport-local";
import bcrypt from "bcrypt";
import db from "./db.js";
import GoogleStrategy from "passport-google-oauth2";

// Passport Local Strategy
passport.use(
  "local",
  new Strategy(
    { usernameField: "username", passwordField: "password" },
    async function verify(username, password, cb) {
      try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          username,
        ]);
        if (result.rows.length > 0) {
          const user = result.rows[0];
          const storedHashedPassword = user.password;
          const passwordMatches = await bcrypt.compare(password, storedHashedPassword);
          return passwordMatches ? cb(null, user) : cb(null, false);
        } else {
          return cb("User not found");
        }
      } catch (err) {
        console.log(err);
      }
    }
  )
);


// Passport Google Strategy
passport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/appa", 
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      },
      async (accessToken, refreshToken, profile, cb) => {
        try {
          console.log(profile);
          const result = await db.query("SELECT * FROM users WHERE email = $1", [
            profile.email,
          ]);
          if (result.rows.length === 0) {
            const newUser = await db.query(
              "INSERT INTO users (email, password, role) VALUES ($1, $2, $3)",
              [profile.email, "google", 3],
            );
            return cb(null, newUser.rows[0]);
          } else {
            return cb(null, result.rows[0]);
          }
        } catch (err) {
          return cb(err);
        }
      },
    ),
  );

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

export default passport;