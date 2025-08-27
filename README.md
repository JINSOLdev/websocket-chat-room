# GIF 채팅방 (Socket.IO · Express · MongoDB)

실시간 GIF/텍스트 채팅에 **참여자 표시**, **시스템 메시지 DB 저장**, **귓속말(1:1 DM)** 을 더한 예제입니다. </br>
세션 기반 **색상 라벨**을 단일 출처로 관리해(HTTP·소켓·템플릿) 표시 값이 일치합니다.

---

## 목차

- [GIF 채팅방 (Socket.IO · Express · MongoDB)](#gif-채팅방-socketio--express--mongodb)
  - [목차](#목차)
  - [기능](#기능)
    - [설치 \& 실행](#설치--실행)
  - [핵심 구조](#핵심-구조)
  - [API \& 소켓 이벤트](#api--소켓-이벤트)
    - [HTTP 엔드포인트](#http-엔드포인트)
    - [소켓 이벤트 (`/chat` 네임스페이스)](#소켓-이벤트-chat-네임스페이스)
  - [데이터 모델](#데이터-모델)
    - [Room](#room)
    - [Chat](#chat)
  - [트러블슈팅](#트러블슈팅)
  - [TODO](#todo)

---

## 기능

- **참여자 수/목록** 실시간 표시

  - 상단에 `참여자 N명` 배지 + 토글 가능한 목록
  - 목록 항목 클릭 → 귓속말 대상 지정

- **시스템 메시지(입장/퇴장) DB 저장**

  - 라우터(`/room/:id/system/{join,exit}`)에서 저장 후 브로드캐스트
  - 새로고침 시에도 과거 시스템 메시지 표시

- **귓속말(1:1 DM)**

  - 목록에서 상대 클릭 → 대상 지정 → 메시지 전송 시 상대와 나에게만 표시

- **세션 컬러 일원화(SSOT)**

  - `req.session.color` 한 곳에서만 생성/사용(HTTP, 소켓, 템플릿 모두 동일)

> 참고: 마지막 사용자가 퇴장하면 해당 방과 채팅은 삭제됩니다.

---


### 설치 & 실행

```bash
# 의존성 설치
npm install

# .env 설정(예시)
# SESSION_SECRET=랜덤_문자열
# MONGO_URL=mongodb://localhost:27017/gifchat

# 서버 실행
node app.js
# 기본 포트: http://localhost:8005
```

---

## 핵심 구조

- **Express + Nunjucks**

  - 페이지 렌더링, 라우팅(`/room/:id` 등)
  - 모든 HTTP 요청에서 `req.session.color` 보장 및 `res.locals.user`로 템플릿에 주입

- **Socket.IO**

  - 네임스페이스: `/room`(방 생성 알림), `/chat`(채팅)
  - 두 네임스페이스 모두 `cookieParser` + `session` 미들웨어 적용
  - 참여자 목록은 `namespace.adapter.rooms.get(roomId)` 기반으로 계산/브로드캐스트

- **MongoDB(Mongoose)**

  - `Room`, `Chat` 스키마
  - 시스템/일반 메시지 저장, GIF 파일명 저장

---

## API & 소켓 이벤트

### HTTP 엔드포인트

| 메서드 | 경로                    | 설명                                            |
| :----: | ----------------------- | ----------------------------------------------- |
|  GET   | `/`                     | 방 목록                                         |
|  GET   | `/room`                 | 방 생성 폼                                      |
|  POST  | `/room`                 | 방 생성 + `/room` 네임스페이스에 새 방 알림     |
|  GET   | `/room/:id`             | 채팅방 화면 렌더링(과거 채팅 불러오기)          |
| DELETE | `/room/:id`             | 마지막 유저 퇴장 시 방/채팅 삭제(에페메랄 정책) |
|  POST  | `/room/:id/chat`        | 일반 텍스트 채팅 저장 + 브로드캐스트            |
|  POST  | `/room/:id/gif`         | GIF 업로드/저장 + 브로드캐스트                  |
|  POST  | `/room/:id/system/join` | 시스템 **입장** 메시지 저장 + 브로드캐스트      |
|  POST  | `/room/:id/system/exit` | 시스템 **퇴장** 메시지 저장 + 브로드캐스트      |

### 소켓 이벤트 (`/chat` 네임스페이스)

- 서버 → 클라이언트

  - `room:participants` : `{ roomId, count, members: [{ socketId, label }]}`
  - `join` / `exit` : `{ user: 'system', chat: string }`
  - `whisper` : `{ user, chat, fromSocketId, toSocketId, roomId, private: true }`
  - `whisper:error` : `{ message }`

- 클라이언트 → 서버

  - `who` : 현재 참여자 목록 1회 요청
  - `whisper:send` : `{ to: socketId, chat: string }`

---

## 데이터 모델

### Room

```ts
{
  _id: ObjectId,
  title: string,
  max: number,
  owner: string,     // 현재는 세션 색상 문자열
  password?: string,
  createdAt: Date
}
```

### Chat

```ts
{
  _id: ObjectId,
  room: ObjectId,    // ref: Room
  user: string,      // 일반: 세션 color, 시스템: 'system'
  chat?: string,     // 텍스트
  gif?: string,      // 업로드 파일명
  createdAt: Date
}
```

---

## 트러블슈팅

- **색상이 `#000000`으로만 보임** </br>
  소켓에서 세션 미들웨어가 적용되지 않았습니다. `/chat`, `/room` 네임스페이스에도 `cookieParser` + `session` 미들웨어가 **반드시** 적용되어야 했습니다.


---

## TODO

- [ ] **중복 전송 방지**

  - 귓속말: 에코/상대 전달 경로 정리(표시는 1회만)
  - 퇴장: 버튼 클릭 vs. `beforeunload` 중복 방지 플래그 보강

- [ ] **방장(Owner) 기능**

  - 방장 표시/권한, 퇴장 시 위임 로직

- [ ] **강퇴(Kick) 기능**

  - 서버: 권한 체크 + 대상 소켓 강제 종료
  - 클라: 방장 전용 Kick UI

- [ ] 귓속말 **DB 저장** (옵션): `private`, `toSocketId` 추가
- [ ] 채팅 **보존/아카이브** 정책(에페메랄 유지 vs TTL/archivedAt)

---
