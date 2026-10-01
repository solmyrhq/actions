# actions

GitHub Actions shared by the solmyrhq organization's private repositories.

Only workflows in solmyrhq repositories can use these actions, because this repository's Actions access level is `organization`. The repository and that setting are declared in `infra/terraform/github-repositories.tf` in the gingerbread repository.

When you use an action from this repository, pin it to a full commit SHA.

## tailnet-ssh

This action joins the tailnet as an ephemeral node for the rest of the job and writes an SSH config for connecting to one host over it. The self-hosted runners cannot use `tailscale/github-action`: it runs `tailscaled` with `sudo`, and the runner user has no `sudo`. This action runs `tailscaled` as the runner user in userspace-networking mode, so the VM's routes and DNS do not change. Only connections made through the SSH config reach the tailnet. When the job ends, whether it passed, failed or was cancelled, the action logs the node out, stops `tailscaled` and deletes its files.

```yaml
- id: tailnet
  uses: solmyrhq/actions/tailnet-ssh@<commit sha>
  with:
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci-platform-deploy
      version: 1.98.9
      sha256: 11be30ad301d48f84ff52fec34f8a2f78eb3e3dee1be4e9624d19fccc8df5540
      host: ${{ secrets.PLATFORM_DEPLOY_HOST }}
      host-fingerprint: ${{ secrets.PLATFORM_DEPLOY_SSH_FINGERPRINT }}
- run: ssh -F "${{ steps.tailnet.outputs.ssh-config }}" -i "$key_file" "$DEPLOY_USER@$DEPLOY_HOST" "platform $DEPLOY_SHA"
```

`sha256` is the checksum of the tarball for the runner's architecture. Tailscale publishes it at `https://pkgs.tailscale.com/stable/tailscale_<version>_amd64.tgz.sha256`. On ARM64 runners, use `arm64` in place of `amd64`. Update `sha256` whenever you change `version`.

ssh uses the settings in the SSH config only when the destination on the ssh command line is exactly the `host` input. With these settings, ssh accepts only an ed25519 host key with the given fingerprint, and does not read or write `known_hosts`.
