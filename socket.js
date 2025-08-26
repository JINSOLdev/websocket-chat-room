const SocketIO = require("socket.io");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const cookie = require("cookie-signature");

// 유틸 함수
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

module.exports = (server, app, sessionMiddleware) => {
  const io = SocketIO(server, { path: "/socket.io" });
  app.set("io", io);
  const room = io.of("/room");
  const chat = io.of("/chat");

  const wrap = (mw) => (socket, next) =>
    mw(socket.request, socket.request.res || {}, next);

  io.use(wrap(cookieParser(process.env.SESSION_SECRET)));
  io.use(wrap(sessionMiddleware));

  room.on("connection", (socket) => {
    console.log("room 네임스페이스에 접속");
    socket.on("disconnect", () => {
      console.log("room 네임스페이스 접속 해제");
    });
  });

  chat.on("connection", (socket) => {
    console.log("chat 네임스페이스에 접속");
    const req = socket.request;

    const { referer = "" } = req.headers || {};
    const roomId = referer
      .split("/")
      [referer.split("/").length - 1]?.replace(/\?.+/, "");

    socket.join(roomId);

    // 세션이 없거나 color가 없어도 절대 크래시하지 않도록
    const sessionId = req.sessionID || socket.id || "";
    const color =
      (req.session && req.session.color) || stringToColor(sessionId);

    socket.to(roomId).emit("join", {
      user: "system",
      chat: `${color}님이 입장하셨습니다.`,
    });

    socket.on("disconnect", () => {
      console.log("chat 네임스페이스 접속 해제");
      socket.leave(roomId);

      const currentRoom = socket.adapter.rooms.get(roomId);
      const userCount = currentRoom ? currentRoom.size : 0;

      if (userCount === 0) {
        let signed = "";
        try {
          const sid = req.signedCookies?.["connect.sid"];
          if (sid) signed = cookie.sign(sid, process.env.SESSION_SECRET);
        } catch {}
        axios
          .delete(`http://localhost:8005/room/${roomId}`, {
            headers: signed ? { Cookie: `connect.sid=s%3A${signed}` } : {},
          })
          .then(() => console.log("방 제거 요청 성공"))
          .catch((error) => console.error(error));
      } else {
        socket.to(roomId).emit("exit", {
          user: "system",
          chat: `${color}님이 퇴장하셨습니다.`,
        });
      }
    });
  });
};
