/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'bcryptjs'],
  poweredByHeader: false,
};
export default nextConfig;
