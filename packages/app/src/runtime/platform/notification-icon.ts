import jabisuIcon from "../../../../desktop/icons/jabisu/notification.png"

/** Picture for system notifications. 자비수 shows 명상 stamping an approval from the app bundle, so it never fetches OpenCode's web icon. */
export const notificationIcon =
  import.meta.env.VITE_OPENCODE_CHANNEL === "jabisu" ? jabisuIcon : "https://opencode.ai/favicon-96x96-v3.png"
