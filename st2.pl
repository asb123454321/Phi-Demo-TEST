open F,"<:utf8","c.txt"; my @ev;
while(<F>){ s/\x{feff}//g; next unless /\S/; my @p=split; push @ev,[$p[0],$p[2]+0,$p[3]+0,$p[4]+0,$p[5]+0,$p[6]+0]; }
my %byx; for(@ev){ $byx{sprintf("%.3f",$_->[3])}++ }
my $n=0; for (sort {$a<=>$b} keys %byx){ printf "%s:%d ",$_,$byx{$_}; $n++ }
print "\n";
# time gaps
my @t = sort {$a<=>$b} map {$_->[1]} @ev;
my %gap; for my $i (1..$#t){ my $d=$t[$i]-$t[$i-1]; $gap{sprintf("%.3f",$d)}++ }
print "gaps: ", join(" ", map {"$_($gap{$_})"} sort {$a<=>$b} keys %gap), "\n";
