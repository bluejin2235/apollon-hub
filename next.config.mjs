export default {
  experimental: {cpus: 2},
  async headers() {
    return [{source: '/:path*', headers: [
      {key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},
      {key:'Cache-Control',value:'no-store'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'no-referrer'},
      {key:'Content-Security-Policy',value:"frame-ancestors 'none'"}
    ]}];
  }
};
