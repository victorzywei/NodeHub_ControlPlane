
=== WARP test via sing-box SOCKS5 127.0.0.1:19080 ===
endpoint: engage.cloudflareclient.com:2408








[FAIL] www.apple.com -> TLS 握手失败
       curl: curl: (28) SSL connection timeout
[FAIL] www.bing.com -> TLS 握手失败
       curl: curl: (28) SSL connection timeout
[FAIL] www.microsoft.com -> TLS 握手失败
       curl: curl: (28) SSL connection timeout
[FAIL] www.google.com -> TLS 握手失败
       curl: curl: (28) SSL connection timeout

Recent sing-box log:
+0800 2026-03-05 00:54:24 INFO network: updated default interface eth0, index 2
+0800 2026-03-05 00:54:24 INFO inbound/socks[socks-in]: tcp server started at 127.0.0.1:19080
+0800 2026-03-05 00:54:25 INFO [2539604087 0ms] inbound/socks[socks-in]: inbound connection from 127.0.0.1:43848
+0800 2026-03-05 00:54:25 INFO [2539604087 0ms] inbound/socks[socks-in]: inbound connection to www.apple.com:443
+0800 2026-03-05 00:54:25 INFO [2539604087 5ms] dns: exchanged CNAME www.apple.com. 20 IN CNAME www-apple-com.v.aaplimg.com.
+0800 2026-03-05 00:54:25 INFO [2539604087 5ms] dns: exchanged CNAME www-apple-com.v.aaplimg.com. 20 IN CNAME e6858.e19.s.tl88.net.
+0800 2026-03-05 00:54:25 INFO [2539604087 5ms] dns: exchanged A e6858.e19.s.tl88.net. 20 IN A 223.111.101.29
+0800 2026-03-05 00:54:25 INFO [2539604087 6ms] dns: lookup succeed for www.apple.com: 223.111.101.29
+0800 2026-03-05 00:54:25 INFO [2539604087 6ms] endpoint/wireguard[warp-ep]: outbound connection to 223.111.101.29:443
+0800 2026-03-05 00:54:26 INFO dns: exchanged AAAA engage.cloudflareclient.com. 600 IN AAAA 2606:4700:d0::a29f:c001
+0800 2026-03-05 00:54:26 INFO dns: exchanged A engage.cloudflareclient.com. 600 IN A 162.159.192.1
+0800 2026-03-05 00:54:26 INFO dns: lookup succeed for engage.cloudflareclient.com: 162.159.192.1 2606:4700:d0::a29f:c001
+0800 2026-03-05 00:54:26 INFO sing-box started (1.877s)
+0800 2026-03-05 00:54:33 INFO [1392378452 0ms] inbound/socks[socks-in]: inbound connection from 127.0.0.1:51486
+0800 2026-03-05 00:54:33 INFO [1392378452 0ms] inbound/socks[socks-in]: inbound connection to www.bing.com:443
+0800 2026-03-05 00:54:33 INFO [1392378452 3ms] dns: exchanged CNAME www.bing.com. 17 IN CNAME www-www.bing.com.trafficmanager.net.
+0800 2026-03-05 00:54:33 INFO [1392378452 4ms] dns: exchanged CNAME www-www.bing.com.trafficmanager.net. 17 IN CNAME china.bing123.com.
+0800 2026-03-05 00:54:33 INFO [1392378452 4ms] dns: exchanged A china.bing123.com. 17 IN A 202.89.233.101
+0800 2026-03-05 00:54:33 INFO [1392378452 4ms] dns: exchanged A china.bing123.com. 17 IN A 202.89.233.100
+0800 2026-03-05 00:54:33 INFO [1392378452 4ms] dns: lookup succeed for www.bing.com: 202.89.233.101 202.89.233.100
+0800 2026-03-05 00:54:33 INFO [1392378452 4ms] endpoint/wireguard[warp-ep]: outbound connection to 202.89.233.101:443
+0800 2026-03-05 00:54:41 INFO [1073428598 0ms] inbound/socks[socks-in]: inbound connection from 127.0.0.1:51488
+0800 2026-03-05 00:54:41 INFO [1073428598 0ms] inbound/socks[socks-in]: inbound connection to www.microsoft.com:443
+0800 2026-03-05 00:54:41 INFO [1073428598 4ms] dns: exchanged CNAME www.microsoft.com. 20 IN CNAME www.microsoft.com-c-3.edgekey.net.
+0800 2026-03-05 00:54:41 INFO [1073428598 4ms] dns: exchanged CNAME www.microsoft.com-c-3.edgekey.net. 20 IN CNAME www.microsoft.com-c-3.edgekey.net.globalredir.akadns.net.
+0800 2026-03-05 00:54:41 INFO [1073428598 4ms] dns: exchanged CNAME www.microsoft.com-c-3.edgekey.net.globalredir.akadns.net. 20 IN CNAME e13678.ca2.s.tl88.net.
+0800 2026-03-05 00:54:41 INFO [1073428598 4ms] dns: exchanged A e13678.ca2.s.tl88.net. 20 IN A 223.111.102.222
+0800 2026-03-05 00:54:41 INFO [1073428598 4ms] dns: lookup succeed for www.microsoft.com: 223.111.102.222
+0800 2026-03-05 00:54:41 INFO [1073428598 4ms] endpoint/wireguard[warp-ep]: outbound connection to 223.111.102.222:443
+0800 2026-03-05 00:54:49 INFO [2341565593 0ms] inbound/socks[socks-in]: inbound connection from 127.0.0.1:34178
+0800 2026-03-05 00:54:49 INFO [2341565593 0ms] inbound/socks[socks-in]: inbound connection to www.google.com:443
+0800 2026-03-05 00:54:49 INFO [2341565593 4ms] dns: exchanged AAAA www.google.com. 18 IN AAAA 2001::1
+0800 2026-03-05 00:54:49 INFO [2341565593 4ms] dns: exchanged A www.google.com. 26 IN A 157.240.17.35
+0800 2026-03-05 00:54:49 INFO [2341565593 4ms] dns: lookup succeed for www.google.com: 157.240.17.35 2001::1
+0800 2026-03-05 00:54:49 INFO [2341565593 4ms] endpoint/wireguard[warp-ep]: outbound connection to 157.240.17.35:443
root@iv-ye3un50p34cva4g8l01y:~# 
root@iv-ye3un50p34cva4g8l01y:~# 






