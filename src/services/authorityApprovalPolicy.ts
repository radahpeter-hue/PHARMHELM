/** UI availability only; Firestore independently authorizes every authority change. */
export function canApproveAuthority(profile:{role?:string;secondaryRoles?:string[]}|null,identity:{email:string|null;emailVerified:boolean}|null) {
 return [profile?.role,...(profile?.secondaryRoles||[])].some(role=>['owner','Owner','CEO','ceo','CEO / MD','ceo / md'].includes(role||''))
  || !!(identity?.emailVerified&&['peterssentongo61@gmail.com','peter.sentongo@pharmhelm','peter.sentongo@pharmhelm.com'].includes(identity.email||''));
}
