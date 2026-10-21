// Files imported as text (`with { type: "text" }`): migrations and the personas' protocols.
declare module "*.sql" {
  const text: string;
  export default text;
}
declare module "*.md" {
  const text: string;
  export default text;
}
