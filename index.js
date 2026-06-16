import dotenv from "dotenv";
dotenv.config();
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import passport from "./passportConfig.js";
import limiter from "./limiter.js";

import registerRoutes from "./routes/registerRoute.js";
import registerAdminRoutes from "./routes/adminRoute.js";
import registerProfileRoutes from "./routes/profileRoute.js";
import registerLearnerRoutes from "./routes/learnerRoute.js";
import registerExamRoutes from "./routes/examsRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(limiter);

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 1000 * 60 * 60 * 24 },
}));

app.use(passport.initialize());
app.use(passport.session());

registerRoutes(app);
registerAdminRoutes(app);
registerProfileRoutes(app);
registerLearnerRoutes(app);
registerExamRoutes(app);



app.listen(port, () => {
  console.log(`Server running on port ${port}.`);
});