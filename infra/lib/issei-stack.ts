import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface IsseiStackProps extends cdk.StackProps {
  // Custom domain is OPTIONAL. Omit both to deploy on the raw ALB DNS over HTTP —
  // enough for a verify-and-teardown artifact, and it needs no Route53 zone (no
  // paid domain registration). Provide both to serve HTTPS at
  // `${apiSubdomain}.${domainName}` with an ACM cert + Route53 alias; adding them
  // later is a config change, not a rewrite (the two paths branch on `useDomain`).
  domainName?: string;     // e.g. "issei.app"
  apiSubdomain?: string;   // e.g. "api" → api.issei.app
  githubOrg: string;       // e.g. "charman02"
  githubRepo: string;      // e.g. "issei"
  // The deployed frontend origin, always allowed in CORS regardless of domain.
  // Defaults to the CANONICAL site. It used to default to the Vercel auto-alias
  // (issei-delta.vercel.app), which is the same deployment under a different name —
  // harmless for CORS, but APP_URL below builds password-reset links from this, so the
  // default sent users to a URL that isn't the product's address.
  frontendOrigin?: string; // default: https://issei.app
}

export class IsseiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IsseiStackProps) {
    super(scope, id, props);

    const useDomain = Boolean(props.domainName && props.apiSubdomain);
    const apiDomain = useDomain
      ? `${props.apiSubdomain}.${props.domainName}`
      : undefined;
    const frontendOrigin = props.frontendOrigin || 'https://issei.app';

    // ─── VPC: public subnets only, no NAT Gateway ($0/mo) ──────────────
    // Neon, Cloudinary, OpenRouter, ECR, SSM, CW are all public-internet
    // reachable. A public-subnet task with assignPublicIp egresses via IGW.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // ─── Security groups ───────────────────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB - internet-facing HTTPS',
      allowAllOutbound: false,
    });
    // :443 for the HTTPS (domain) path; :80 serves traffic directly in the
    // no-domain path and is the HTTP→HTTPS redirect in the domain path.
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc,
      description: 'Fargate tasks - ingress from ALB only',
      allowAllOutbound: true, // egress to Neon:5432, Cloudinary/OpenRouter:443, ECR, SSM
    });
    serviceSg.addIngressRule(albSg, ec2.Port.tcp(8000), 'ALB to container port 8000');

    // ─── ECS cluster ───────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'issei',
    });

    // ─── Log group ─────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/issei-api',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Secrets from SSM Parameter Store (SecureString, Standard tier) ─
    const ssmParams = [
      'DATABASE_URL',
      'JWT_SECRET',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      'OPENROUTER_API_KEY',
      // Push notifications (#89). Adding a name here ALSO grants the execution role read on that
      // parameter, which is the half `.aws/task-definition.json` cannot express — see the note in
      // infra/RUNBOOK.md Step 1b about doing it by hand when the pipeline is what deploys.
      'VAPID_PRIVATE_KEY',
      'VAPID_PUBLIC_KEY',
      'VAPID_SUBJECT',
      'CRON_SECRET',
    ];
    const secrets: Record<string, ecs.Secret> = {};
    for (const name of ssmParams) {
      secrets[name] = ecs.Secret.fromSsmParameter(
        ssm.StringParameter.fromSecureStringParameterAttributes(this, `Param-${name}`, {
          parameterName: `/issei/${name}`,
        }),
      );
    }

    // ─── Task definition ───────────────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // ECR repository for CI/CD image pushes (GitHub Actions workflow)
    const repo = new ecr.Repository(this, 'Repo', {
      repositoryName: 'issei-api',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 10, description: 'Keep last 10 images' }],
    });

    // Container image built from the repo root (Dockerfile + .dockerignore)
    const image = new ecr_assets.DockerImageAsset(this, 'Image', {
      directory: path.join(__dirname, '..', '..'),  // repo root
      platform: ecr_assets.Platform.LINUX_ARM64,
    });

    taskDef.addContainer('issei-api', {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      portMappings: [{ containerPort: 8000 }],
      secrets,
      environment: {
        // OPENROUTER_MODEL is deliberately unset — recipe_ai.py's DEFAULT_MODEL
        // is the source of truth. Override only to change it.
        // With a domain, referer is the site; without, the frontend origin.
        OPENROUTER_REFERER: useDomain
          ? `https://${props.domainName}`
          : frontendOrigin,
        // The configured frontend origin is always allowed; with a custom domain, apex
        // and www are added too. (The live prod value additionally lists the Vercel alias
        // so that URL keeps working — see .aws/task-definition.json, which is what the
        // deploy workflow actually ships; this stack is the from-scratch definition.)
        CORS_ORIGINS: useDomain
          ? `https://${props.domainName},https://www.${props.domainName},${frontendOrigin}`
          : frontendOrigin,
        // SES sender address — must be a verified SES identity in us-west-2.
        SENDER_EMAIL: 'noreply@issei.app',
        // Frontend URL used to build the password-reset link in the email. Follows the
        // custom domain when set, like OPENROUTER_REFERER above: a link a real person
        // clicks out of their inbox should be the product's address, not a deploy alias.
        APP_URL: useDomain ? `https://${props.domainName}` : frontendOrigin,
        // How often the in-process daily-prompt ticker runs (app/services/prompt_scheduler.py).
        // A PLAIN env var rather than an SSM secret: it is not sensitive, and the point of having
        // it here at all is that "0" is the emergency stop for a misbehaving loop.
        //
        // Read the honest limits before relying on that. 0 DISABLES IT — 0, not blank. And
        // registering a revision by hand is only half the gesture: the service holds a concrete
        // revision ARN, so it also needs `aws ecs update-service --task-definition <family>:<rev>
        // --force-new-deployment` before new tasks pick it up. Even then the pipeline renders every
        // revision from `.aws/task-definition.json`, so the NEXT merge to main silently puts 600
        // back — emergency stop, not a durable setting. For durable, edit that file and ship it.
        // Wired in both places per infra/RUNBOOK.md: only the JSON ships, and keeping them in step
        // is what stops the stack file from quietly describing something prod isn't doing.
        PROMPT_SCHEDULER_INTERVAL_SECONDS: '600',
        // THE OFF SWITCH FOR RATE LIMITING (`app/services/rate_limit.py`). Wired here for the same
        // reason as the line above -- only the JSON ships, and a stack file describing a prod that
        // doesn't exist is the drift `tests/test_deploy_config.py` pins. This one is worth reaching
        // for by hand: every other failure in this app degrades quietly, but a misfiring limiter
        // locks real people out of their own accounts, and the same `update-service` caveat applies.
        RATE_LIMIT_ENABLED: 'true',
        // HOW MANY APPENDING PROXIES SIT IN FRONT. 1 = the ALB below and nothing else. NOT a tuning
        // knob -- a statement about the network, and the limiter breaks in one of two directions if
        // it is wrong: too low and every user shares the ALB's address in one bucket (the first
        // attacker locks out the whole app), too high and it reads an attacker-written element of
        // `X-Forwarded-For` (every request gets a fresh bucket and the limit does nothing). Put
        // CloudFront in front of this ALB and it becomes 2.
        TRUSTED_PROXY_HOPS: '1',
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'ecs' }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen(\'http://127.0.0.1:8000/health\',timeout=2).status==200 else 1)"',
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(3),
        retries: 3,
        startPeriod: cdk.Duration.seconds(10),
      },
    });

    // The execution role needs pull access to the CI/CD ECR repo (issei-api).
    // CDK auto-grants pull for the DockerImageAsset staging repo, but GitHub
    // Actions pushes to the named repo — without this the task can't start.
    repo.grantPull(taskDef.executionRole!);

    // Grant the task role permission to send email via SES (password resets).
    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    // ─── ALB ───────────────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: cdk.Duration.seconds(65), // > 25s OpenRouter httpx timeout
    });

    // The target group is shared by whichever listener is active. Health check on
    // /health/ready proves DB reachability (a task that can't reach Neon fails and
    // the circuit breaker rolls back, rather than reporting "green" over a dead DB).
    const targets = {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [] as elbv2.IApplicationLoadBalancerTarget[], // filled after service
      healthCheck: {
        path: '/health/ready',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(15),
    };

    // ─── Fargate service ───────────────────────────────────────────────
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,  // required — no NAT
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      circuitBreaker: { rollback: true },
      serviceName: 'issei-api',
      // Set explicitly (the default is version-dependent). With one task, keep the
      // old one serving until the new one is healthy (no forced dip below desired),
      // and allow a second temporarily so a deploy is a true rolling replace.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    targets.targets = [service];

    // ─── Listener(s) ────────────────────────────────────────────────────
    // WITH a domain: ACM cert on :443, HTTP→HTTPS redirect on :80, Route53 alias.
    // WITHOUT: the service is served directly over HTTP on :80 (raw ALB DNS) —
    // no cert, no zone, no paid domain. Same target group + health check either way.
    if (useDomain) {
      const zone = route53.HostedZone.fromLookup(this, 'Zone', {
        domainName: props.domainName!,
      });
      const cert = new acm.Certificate(this, 'Cert', {
        domainName: apiDomain!,
        validation: acm.CertificateValidation.fromDns(zone),
      });

      alb.addListener('HttpRedirect', {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });

      const httpsListener = alb.addListener('Https', {
        port: 443,
        certificates: [cert],
      });
      // The service is the listener's default action — every request routes to it
      // (this is an API; there's no "other" traffic to 404). addTargets sets it.
      httpsListener.addTargets('Targets', targets);

      new route53.ARecord(this, 'ApiAlias', {
        zone,
        recordName: props.apiSubdomain!,
        target: route53.RecordTarget.fromAlias(
          new route53_targets.LoadBalancerTarget(alb),
        ),
      });
    } else {
      const httpListener = alb.addListener('Http', { port: 80 });
      // Service is the sole default action (see the HTTPS branch note).
      httpListener.addTargets('Targets', targets);
    }

    // ─── GitHub Actions OIDC ───────────────────────────────────────────
    const oidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'issei-github-deploy',
      assumedBy: new iam.WebIdentityPrincipal(
        oidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub':
              `repo:${props.githubOrg}/${props.githubRepo}:ref:refs/heads/main`,
          },
        },
      ),
      description: 'GitHub Actions: build + push image, run migrations, deploy ECS service',
    });

    // Least-privilege: ECR push, ECS deploy, IAM pass-role for task + exec roles
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:CompleteLayerUpload',
        'ecr:InitiateLayerUpload',
        'ecr:PutImage',
        'ecr:UploadLayerPart',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
      ],
      resources: [repo.repositoryArn, image.repository.repositoryArn],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecs:RegisterTaskDefinition',
        'ecs:DeregisterTaskDefinition',
        'ecs:DescribeTaskDefinition',
        'ecs:DescribeServices',
        'ecs:UpdateService',
      ],
      resources: ['*'], // task defs are account-wide; service scoped below if needed
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [
        taskDef.taskRole.roleArn,
        taskDef.executionRole!.roleArn,
      ],
    }));

    // ─── Outputs ───────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AlbDns', { value: alb.loadBalancerDnsName });
    // The URL to hit: the custom domain over HTTPS, or the raw ALB over HTTP.
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: useDomain
        ? `https://${apiDomain}`
        : `http://${alb.loadBalancerDnsName}`,
    });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
