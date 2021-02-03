---
title: The RAFT Consensus Algorithm
date: "2021-01-31"
template: "post"
draft: false
slug: "raft-consensus"
category: "Distributed Systems"
author: "Sidharth Sankhe"
tags:
  - "Distributed Systems"
  - "Consensus Algorithms"
description: "The RAFT consensus protocol establishes a method for distributed consensus in a cluster of machines, by managing a replicated log. RAFT cleanly separates the key elements of consensus: leader election, failure recovery and safety and thus is a lot easier to understand than Paxos."
socialImage: "/media/raft.jpg"
---

Consensus algorithms hold a very important place in distributed systems design, allowing a cluster of machines to work as a coherent group with failure transparency (i.e. the end user does not know when individual machines in the cluster have failed as long as some are alive). The easiest application to visualize is a replicated key-value store, and we'll use this to make the discussion on RAFT concrete. 

RAFT is an algorithm that allows a cluster of machines to act as a [replicated state machine](https://en.wikipedia.org/wiki/State_machine_replication) which essentially means that each machine has identical state and changes to that state are carried out in the same order on all the machines. The state for a key-value store will be the key-value pairs, and a replicated state machine means that all the writes(creation and deletion) occur in the same order. This is very useful, because if one of the machines goes down, we have a bunch of other machines with identical state. RAFT does this by managing a replicated log of operations. So in the case of the key-value store, it would look something like:
```
PUT key:ComputerSystems value:Article1
PUT key:ComputerSystems value:Article2
DELETE key:ComputerSystems
```

If all machines in the cluster maintain this log, each machine agrees on the order of log operations and applies the operation to its internal state, we will have a replicated state machine! The challenge is maintenance of the log: how do we ensure that all the machines agree on the order of these log operations in the face of network failures, network latencies, machine failures, and other adversarial conditions. This is what RAFT aims to solve. 

## A Deeper Dive into RAFT

RAFT implements consensus by first electing a distinguished *leader* that accepts operations from *clients*. Clients in this case will be users of the key-value store: if I want to store a value, I'll connect to the leader over the network and send my request. RAFT does this because it simplifies management of the replicated log. Given this model, consensus is broken up into three independent subproblems: 
1. **Leader Election**: how do we choose the leader when the system starts, or when we detect that the current leader has failed?
2. **Log Replication**: how does the leader then ensure that the log entries are replicated on all the machines?
3. **Safety**: how can we ensure that all the machines apply the logs in the same order? In other words, if any machine applies a log entry at a particular index, no server should apply a different entry to that same index. 

### RAFT Basics

RAFT clusters are made up of an odd number of machines, and a cluster with *2n+1* machines can tolerate *n* failures, because we want a majority of the machines to be alive at any given time. At any given time, a machine is either a *leader*, a *follower* or a *candidate*. During normal operation, there is exactly one leader and all the other servers are followers, just responding to the leader's requests. The leader is responsible for client requests and also for maintaining the log. The candidate state occurs in leader election, where this state signifies that the servers is a possible contender for the next leader. 

RAFT operation is divided into *terms* of arbitrary length, numbered with consecutive integers. Each term begins with an *election*, where the leader for that term is decided. If there is a split vote for leader election, then there will be a randomized backoff, and leader election will take place again. Thus, RAFT ensures that there is only one leader in any given term. The following figure, taken from the paper, illustrates this:
![Raft terms](/media/raft-terms.jpg)

These term numbers are important because they act as a logical clock for the system. Some servers (if in a network partition, or other cases) may miss complete terms. The term numbers helps the machines detect stale leaders and old information. 

Communication in this system happens via [Remote Procedure Calls](https://en.wikipedia.org/wiki/Remote_procedure_call) (RPCs). This is essentially an abstraction over a traditional TCP connection that allows a server to call a function on another server. One can view it as a simple function call, but where the function executes on another server rather than on the server making the call. The system contains only 2 main RPCs, the **AppendEntries** RPC and the **RequestVote** RPC.
We will now look into the first problem of leader election, and how RAFT does this. 

### Leader Election in RAFT

When servers start up, they are all in the *follower* state. Leader election happens with heartbeats, which is an important concept in distributed systems. Heartbeats are when servers send out periodic messages to simply indicate that they are alive. If a server sees a certain period of time without a heartbeat, it will assume that the leader has died, and then will transition to the *candidate* state. The threshold of time before the follower concludes that the leader is dead is called an *election timeout*. Note that these election timeouts are randomized per server, and so they won't all transition into candidacy at the same time.

When a *follower* becomes a *candidate*, it votes for itself and then issues RequestVotes RPCs to all the other servers in the cluster. A candidate will become a leader if it receives votes from a majority of the servers in the cluster. It also may be the case where there is a race: two servers transition into candidacy at about the same time. Since we are using a majority vote and each server can only vote for one server, only one can win the race. Thus, if a server is in the candidate stage and it recieves an AppendEntriesRPC from another server with a term number that is atleast as large as its own term number, it will recognize that another server has won the race and will transition back to the follower state. 

It may also be the case that there is a split vote, if many followers become candidates at the same time. IN this case, the candidate will time-out and then start a new election by incrementing its term and starting a new round of RequestVotes RPCs. To prevent a livelock (where the split votes occur indefinitely), RAFT adds randomization to the election timeouts, and they are randomly chose from a fixed interval (150ms-300ms). 

See the figure (taken from the paper) below for an explanation of the mechanism of the RequestVotes RPC.

![Request Votes RPC](/media/raft-reqvotes.jpg)

### Log Replication in RAFT 

Once a leader has been elected, it begins servicing client requests. Each request contains a command to be executed by the replicated state machines. The leader appends this command to its own log, and then issues AppendEntries RPCs in parallel to all the servers in the cluster (spins up a thread to send AppendEntries RPCs). If the follower doesn't respond due to a crash or loss of network packets, the AppendEntries RPC will be retried indefinitely, even after respnding to the client. Logs are organized as follows, with each entry storing a state machine command, along with the term number. In the figure below (taken from the paper), the state consists of two variables *x* and *y*, whose values are updated. 

![Log layout in RAFT](/media/raft-log.jpg)

Entries need to be *committed* to the log, they aren't executed as soon as they're received, because RAFT has to guarantee that this entry will be durable. The leader commits an entry, i.e. allows it to be applied to the state machine when a majority of servers have appended it to their local logs. A committing of a particular log index, also commits all previous entries not yet committed. The leader keeps track of the highest entry it has committed, and then sends that in the AppendEntries RPCs for the other servers to eventually find out. The AppendEntries RPC works as shown in the figure (taken from the paper) below. 

![Append Entries RPC](/media/raft-appendentries.jpg)

This RPC was designed to maintain a high degree of coherence between logs on different servers. In particular, RAFT maintains the Log Matching Property, which states that:
1. If two entries in different logs have the same index and term, then they store the same command.
2. If two entries in different logs have the same index and term, then the logs are identical in all preceding entries. 

The first property follows from the fact that a leader creates at most one entry with a given log index in a given term, and log entries never change position. We will dive into this deeper while looking at some failure scenarios. The second property follows from the simple consistency check performed by the AppendEntries RPC. As shown above, arguments to the AppendEntries RPC include `prevLogIndex` and `prevLogTerm` which are the log index and term of the entry immediately preceding the entries sent. If the follower's log does not match this, it refuses the new entries. This acts as an induction step, always ensuring that the logs agree. 

In the absence of any failures, there will be no case where the logs disagree. However, crashes can leave logs inconsistent. A follower might crash and come back up after some log entries have already been committed (remember, the system will continue to function if a majority of the servers are up), and thus might be missing some entries. The follower might also have extra entries not present on the current leader (try to think of a scenario where this could occur). RAFT handles this by forcing the follower's logs to agree with its own. This means that any entries not on the leader's log will be overwritten or deleted. This occurs through the AppendEntries RPC. Notice that if the follower's log does not agree with the leader's log, the AppendEntries consistency check will fail, and the new entries will get rejected. Once this happens, the leader will decrement the `prevLogIndex` and send the entry at the new `prevLogIndex`. This will continue until either there is a match, or the follower is forced to overwrite its log completely with the entire log of the leader. This is a clever method because the leader does not have to take any additional or special measures to ensure log consistency, the AppendEntries RPC will take care of that. 

### Safety in RAFT

The rewriting of logs seems potentially dangerous. How can we be sure that we do not rewrite an entry that has already been applied to the state machine? If someone sends a `PUT` request and that is overwritten, the client will suddenly and inexplicably find his key absent from the database, which is unacceptable behavior. We need to add one more feature to RAFT leader election to ensure that safety is maintained. 

Essentially, what we want is that every leader who gets elected should have a log that contains all the committed entries. Recall that committed entries are those that have already been applied to the state machine. The need for this is evident, if the newly elected leader did not contain all the committed entries, then it would overwrite logs such that some committed entries would be deleted. RAFT uses the voting process to prevent a candidate from winning an election unless its log contains all the committed entries. A candidate must contact a majority of the servers to get elected, and it will only recieve a vote if its log is atlease as up-to-date as the server it is requesting a vote from. This is where the importance of the majority comes in. We know that in order for an entry to be committed, it has to be replicated on a majority of the servers. Therefore, the candidate will need to receive atleast one vote from a server that has a log that contains all the committed entries, implying that the candidate will have a log atleast as up-to-date as the server in question. This means that all elected leaders will contain ALL committed entries, and we will never find an unsafe scenario. 

For a more formal proof of the Safety property, see the RAFT paper.

## Zooming Out and Applications

RAFT is used for a number of machines in a cluster to maintain replicated state, and it does this using the mechanisms we described above. While consensus is a fairly complicated issue to deal with, RAFT makes it simpler by decomposing it into three independent subproblems, and then solving each one of them **understandably**. A multitude of companies in industry utilize RAFT in order to maintain this distributed hyperledger. CockroachDB uses RAFT to perform all the writes to its databases so that writes occur in a fault-tolerant manner. A number of blockchains have also adopted RAFT (albeit a Byzantine Fault Tolerant one) as a consensus protocol. 

## Conclusion

We thus saw how RAFT maintains a distributed log amongst multiple machines. RAFT is similar to Paxos (a very widely used consensus algorithm) in terms of performance and guarantees, but is a lot more understandable and implementable (try implementing a distributed version of RAFT if you want, message the distributed-systems channel on Slack for tips on how to get started). It also touches on a lot of topics that are core to distributed systems such as fault tolerance, a leader-follower model, RPCs for communication, heartbeats and consensus. 