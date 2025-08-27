const express = require("express");
const path = require("path");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const nunjucks = require("nunjucks");
const dotenv = require("dotenv");

dotenv.config();
const webSocket = require("./socket");
const indexRouter = require("./routes");
const connect = require("./schemas");

const app = express();

app.set("port", process.env.PORT || 8005);
app.set("view engine", "html");
nunjucks.configure("views", { express: app, watch: true });
connect();

const sessionMiddleware = session({
  resave: false,
  saveUninitialized: false,
  secret: process.env.SESSION_SECRET,
  cookie: { httpOnly: true, secure: false },
});

app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/gif", express.static(path.join(__dirname, "uploads")));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(sessionMiddleware);

// 공용 색상 해시
function stringToColor(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  let color = "#";
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).slice(-2);
  }
  return color;
}

// 모든 HTTP 요청에서 세션 color 보장 + 템플릿에 내려주기
app.use((req, res, next) => {
  if (!req.session.color) {
    req.session.color = stringToColor(req.sessionID || "");
  }
  res.locals.user = req.session.color; // 템플릿 {{ user }}
  next();
});

app.use("/", indexRouter);

app.use((req, res, next) => {
  const error = new Error(`${req.method} ${req.url} 라우터가 없습니다.`);
  error.status = 404;
  next(error);
});

app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = process.env.NODE_ENV !== "production" ? err : {};
  res.status(err.status || 500);
  res.render("error");
});

const server = app.listen(app.get("port"), () => {
  console.log(app.get("port"), "번 포트에서 대기중");
});

webSocket(server, app, sessionMiddleware);
