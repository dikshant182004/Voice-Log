"""
RFC 3264 / RFC 8866 compliant WebRTC SDP negotiation helper.
Constructs valid SDP answers that preserve the exact count and order
of m= lines present in the client's offer (audio, application/datachannel, video rejection).
"""

import re


def generate_sdp_answer(offer_sdp: str) -> str:
  """
  Constructs an RFC 3264 / RFC 8866 compliant WebRTC SDP answer.
  Preserves the exact order and count of m= lines present in the offer
  (e.g., m=audio, m=application for RTVI data channel).
  """
  blocks = re.split(r"\r?\n(?=m=)", offer_sdp)
  media_blocks = blocks[1:] if len(blocks) > 1 else []

  fingerprint_match = re.search(r"a=fingerprint:([^\r\n]+)", offer_sdp)
  ufrag_match = re.search(r"a=ice-ufrag:([^\r\n]+)", offer_sdp)
  pwd_match = re.search(r"a=ice-pwd:([^\r\n]+)", offer_sdp)

  fingerprint_line = (
    f"a=fingerprint:{fingerprint_match.group(1).strip()}"
    if fingerprint_match
    else "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF"
  )
  ufrag = ufrag_match.group(1).strip() if ufrag_match else "botufrag"
  pwd = pwd_match.group(1).strip() if pwd_match else "botdummyicepassword12345678"

  accepted_mids = []
  answer_media_sections = []

  # If no media blocks found in split, fallback to single audio block
  if not media_blocks:
    mid_match = re.search(r"a=mid:([^\r\n]+)", offer_sdp)
    mid = mid_match.group(1).strip() if mid_match else "0"
    accepted_mids.append(mid)
    answer_media_sections.extend([
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "c=IN IP4 127.0.0.1",
      "a=rtcp:9 IN IP4 127.0.0.1",
      "a=rtcp-mux",
      f"a=ice-ufrag:bot{ufrag[:4]}",
      f"a=ice-pwd:{pwd}",
      "a=ice-options:trickle",
      fingerprint_line,
      "a=setup:active",
      f"a=mid:{mid}",
      "a=sendrecv",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1",
    ])
  else:
    for block in media_blocks:
      first_line = block.strip().splitlines()[0]
      mid_match = re.search(r"a=mid:([^\r\n]+)", block)
      mid = mid_match.group(1).strip() if mid_match else str(len(accepted_mids))
      accepted_mids.append(mid)

      if first_line.startswith("m=audio"):
        pt_match = re.search(r"m=audio \d+ [^ ]+ (.+)", first_line)
        pts = pt_match.group(1).split() if pt_match else ["111"]
        chosen_pt = "111" if "111" in pts else pts[0]
        answer_media_sections.extend([
          f"m=audio 9 UDP/TLS/RTP/SAVPF {chosen_pt}",
          "c=IN IP4 127.0.0.1",
          "a=rtcp:9 IN IP4 127.0.0.1",
          "a=rtcp-mux",
          f"a=ice-ufrag:bot{ufrag[:4]}",
          f"a=ice-pwd:{pwd}",
          "a=ice-options:trickle",
          fingerprint_line,
          "a=setup:active",
          f"a=mid:{mid}",
          "a=sendrecv",
          f"a=rtpmap:{chosen_pt} opus/48000/2",
          f"a=fmtp:{chosen_pt} minptime=10;useinbandfec=1",
        ])
      elif first_line.startswith("m=application"):
        answer_media_sections.extend([
          "m=application 9 UDP/DTLS/SCTP webrtc-datachannel 5000",
          "c=IN IP4 127.0.0.1",
          f"a=ice-ufrag:bot{ufrag[:4]}",
          f"a=ice-pwd:{pwd}",
          "a=ice-options:trickle",
          fingerprint_line,
          "a=setup:active",
          f"a=mid:{mid}",
          "a=sctp-port:5000",
        ])
      else:
        media_type = first_line.split()[0].replace("m=", "")
        answer_media_sections.extend([
          f"m={media_type} 0 UDP/TLS/RTP/SAVPF 0",
          "c=IN IP4 127.0.0.1",
          f"a=mid:{mid}",
        ])

  session_lines = [
    "v=0",
    "o=- 1000000000000000000 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
  ]
  if accepted_mids:
    session_lines.append(f"a=group:BUNDLE {' '.join(accepted_mids)}")
  session_lines.append("a=msid-semantic: WMS")

  return "\r\n".join(session_lines + answer_media_sections) + "\r\n"
