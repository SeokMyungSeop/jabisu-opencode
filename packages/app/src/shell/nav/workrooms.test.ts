import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { groupWorkrooms } from "./workrooms"

const session = (id: string, directory: string, updated: number, projectID = "") =>
  ({
    id,
    projectID,
    title: id,
    location: { directory },
    time: { created: 1, updated },
  }) as SessionInfo

describe("groupWorkrooms", () => {
  const budget = { id: "budget", worktree: "C:/Docs/자비수 작업실/예산" }
  const minutes = { id: "minutes", worktree: "C:/Docs/자비수 작업실/회의록" }
  const empty = { id: "empty", worktree: "C:/Docs/기본 작업실" }

  test("holds each conversation in its room, newest rooms and conversations first", () => {
    const rooms = groupWorkrooms(
      [empty, budget, minutes],
      [
        session("b1", budget.worktree, 10),
        session("m1", minutes.worktree, 30),
        session("b2", budget.worktree, 20),
        session("x", "C:/elsewhere", 99),
      ],
    )

    expect(rooms.map((room) => room.project.id)).toEqual(["minutes", "budget", "empty"])
    expect(rooms[1]?.sessions.map((item) => item.id)).toEqual(["b2", "b1"])
    expect(rooms[1]?.updated).toBe(20)
    expect(rooms[2]).toMatchObject({ sessions: [], updated: undefined })
  })

  test("finds a conversation's room by its project when its folder is not the room's", () => {
    const rooms = groupWorkrooms([budget], [session("b", "C:/Docs/worktrees/예산-2", 5, "budget")])

    expect(rooms[0]?.sessions.map((item) => item.id)).toEqual(["b"])
  })

  test("keeps rooms without conversations in their own order", () => {
    expect(groupWorkrooms([minutes, empty], []).map((room) => room.project.id)).toEqual(["minutes", "empty"])
  })
})
