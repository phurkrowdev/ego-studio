CREATE TABLE `jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(64) NOT NULL,
	`state` enum('NEW','CLAIMED','RUNNING','DONE','FAILED') NOT NULL,
	`metadata` text NOT NULL,
	`ownerId` varchar(64),
	`leaseExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL,
	`updatedAt` timestamp NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_jobId_unique` UNIQUE(`jobId`)
);
