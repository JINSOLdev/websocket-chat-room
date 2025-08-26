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

  // 참여자 라벨 저장 : socket.id -> 닉네임/표시이름
  const labelBySocketId = new Map();

  // 방 참여자 목록 계산
  function getParticipants(namespace, roomId) {
    const set = namespace.adapter.rooms.get(roomId);
    const ids = set ? [...set] : [];
    const members = ids.map((sid) => ({
      socketId: sid,
      label: labelBySocketId.get(sid) || sid.slice(0, 5),
    }));
    return { roomId, count: members.length, members };
  }

  // 방 전체에 참여자 목록 브로드캐스트
  function broadcastParticipants(namespace, roomId) {
    namespace
      .to(roomId)
      .emit("room:participants", getParticipants(namespace, roomId));
  }

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

    // 지금은 color 문자열을 사용자 라벨로 사용
    labelBySocketId.set(socket.id, color);

    // 참여자 목록을 방 전체에 블로드 캐스트
    broadcastParticipants(chat, roomId);

    // 클라이언트가 현재 목록을 요청할 때
    socket.on("who", () => {
      socket.emit("room:participants", getParticipants(chat, roomId));
    });

    socket.on("disconnect", () => {
      console.log("chat 네임스페이스 접속 해제");
      socket.leave(roomId);

      // 내 라벨 정리
      labelBySocketId.delete(socket.id);

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
      }

      // 최신 참여자 목록을 한 번 더 브로드캐스트 (중복되어도 안전함)
      broadcastParticipants(chat, roomId);
    });
  });
};
