import { redirect } from "next/navigation";

/** 예전 「이미지」 메뉴. 기타로 합쳤다. */
export default function WebsiteMediaRedirectPage() {
  redirect("/website/etc");
}
