// ‼️ TODO:
// - 귓속말 중복 전송 방지(emit 경로 단일화)
// - 퇴장 메시지 이중 전송 방지(버튼 클릭 시 beforeunload 중복 차단 플래그 유지 점검)
// - (정책 결정) 마지막 사용자 퇴장 시 채팅 보존/아카이브 방식 검토


const SocketIO = require("socket.io");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const cookie = require("cookie-signature");

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

module.exports = (server, app, sessionMiddleware) => {
  const io = SocketIO(server, { path: "/socket.io" });
  app.set("io", io);

  const room = io.of("/room");
  const chat = io.of("/chat");

  // 참여자 라벨 저장 : socket.id -> 표시 라벨(여기서는 color)
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

  // express 미들웨어를 socket.io에 래핑
  const wrap = (mw) => (socket, next) =>
    mw(socket.request, socket.request.res || {}, next);

  // 전역 미들웨어
  io.use(wrap(cookieParser(process.env.SESSION_SECRET)));
  io.use(wrap(sessionMiddleware));

  // 네임스페이스에도 확실히 같은 미들웨어 적용 (세션 없어서 터지는 것 방지)
  [room, chat].forEach((nsp) => {
    nsp.use(wrap(cookieParser(process.env.SESSION_SECRET)));
    nsp.use(wrap(sessionMiddleware));
    // 세션 color 보장 미들웨어
    nsp.use((socket, next) => {
      const req = socket.request;
      if (!req.session) req.session = {};
      if (!req.session.color) {
        req.session.color = stringToColor(req.sessionID || socket.id);
        try {
          req.session.save?.();
        } catch {}
      }
      next();
    });
  });

  room.on("connection", (socket) => {
    console.log("room 네임스페이스에 접속");
    socket.on("disconnect", () => {
      console.log("room 네임스페이스 접속 해제");
    });
  });

  chat.on("connection", (socket) => {
    console.log("chat 네임스페이스에 접속");
    const req = socket.request;

    // 방 ID 추출
    const { referer = "" } = req.headers || {};
    const roomId = referer
      .split("/")
      [referer.split("/").length - 1]?.replace(/\?.+/, "");

    socket.join(roomId);

    // 세션 color만 사용 (재계산 금지)
    const color = req.session.color;
    labelBySocketId.set(socket.id, color);

    // 참여자 목록 브로드캐스트
    broadcastParticipants(chat, roomId);

    // 현재 목록 요청 응답
    socket.on("who", () => {
      socket.emit("room:participants", getParticipants(chat, roomId));
    });

    socket.data.roomId = roomId;

    // 귓속말 전송
    socket.on("whisper:send", ({ to, chat: msg }) => {
      const rid = socket.data.roomId || roomId;
      if (!to || !msg) return;

      const set = socket.adapter.rooms.get(rid);
      if (!set || !set.has(to)) {
        socket.emit("whisper:error", { message: "상대가 방에 없습니다." });
        return;
      }
      if (to === socket.id) {
        socket.emit("whisper:error", {
          message: "자기 자신에게는 보낼 수 없어요.",
        });
        return;
      }

      const payload = {
        user: socket.request.session.color, // 세션 color만 사용
        chat: msg,
        fromSocketId: socket.id,
        toSocketId: to,
        roomId: rid,
        private: true,
      };

      socket.to(to).emit("whisper", payload);
      socket.emit("whisper", payload); // echo
    });

    // 디버그: 세션 확인
    console.log("[SOCK]", req.sessionID, req.session?.color);

    socket.on("disconnect", () => {
      console.log("chat 네임스페이스 접속 해제");
      socket.leave(roomId);

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

      broadcastParticipants(chat, roomId);
    });
  });
};
